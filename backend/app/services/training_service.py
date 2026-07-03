import platform
import time
from datetime import datetime, timezone
from pathlib import Path

from app.config import RUNS_DIR
from app.schemas.training import TrainRequest
from app.services import job_service, yolo_service
from app.utils.errors import AppError

# Maps job_id -> the live ultralytics BaseTrainer instance, so a stop request from another
# request thread can flip trainer.stop and let it exit its training loop gracefully.
_active_trainers: dict[str, object] = {}
# Tracks job_ids where the user explicitly requested a stop, since ultralytics also sets
# trainer.stop=True on ordinary end-of-training (epoch >= total epochs) — that alone can't
# tell a manual stop apart from a normal finish.
_stop_requested: set[str] = set()


def _cpu_name() -> str:
    try:
        import winreg

        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
        name, _ = winreg.QueryValueEx(key, "ProcessorNameString")
        return name.strip()
    except Exception:
        return platform.processor() or platform.uname().processor or "CPU"


def get_device_info() -> dict:
    cpu_name = _cpu_name()
    try:
        import torch
    except ImportError:
        return {"cuda_available": False, "device_name": None, "cpu_name": cpu_name}
    available = torch.cuda.is_available()
    name = None
    if available:
        try:
            name = torch.cuda.get_device_name(0)
        except Exception:
            # Transient driver hiccups (common on laptops with power-managed GPUs) shouldn't
            # 500 this endpoint — just report the GPU as present without a resolved name.
            available = False
    return {"cuda_available": available, "device_name": name, "cpu_name": cpu_name}


def request_stop(job_id: str) -> bool:
    trainer = _active_trainers.get(job_id)
    if trainer is None:
        return False
    _stop_requested.add(job_id)
    trainer.stop = True
    return True


def list_runs() -> list[dict]:
    import yaml

    if not RUNS_DIR.exists():
        return []
    runs = []
    for run_dir in sorted(RUNS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not run_dir.is_dir():
            continue
        weights_dir = run_dir / "weights"
        has_best = (weights_dir / "best.pt").exists()
        has_last = (weights_dir / "last.pt").exists()
        if not (has_best or has_last):
            continue

        dataset = None
        total_epochs = None
        args_file = run_dir / "args.yaml"
        if args_file.exists():
            args = yaml.safe_load(args_file.read_text()) or {}
            data_path = args.get("data")
            if data_path:
                dataset = Path(data_path).parent.name
            total_epochs = args.get("epochs")

        completed_epochs = 0
        results_file = run_dir / "results.csv"
        if results_file.exists():
            with open(results_file) as f:
                completed_epochs = max(0, sum(1 for _ in f) - 1)

        runs.append({
            "run_name": run_dir.name,
            "dataset": dataset,
            "has_best": has_best,
            "has_last": has_last,
            "completed_epochs": completed_epochs,
            "total_epochs": total_epochs,
            "is_interrupted": bool(total_epochs) and completed_epochs < total_epochs,
        })
    return runs


def _shutdown_loader_workers(loader) -> None:
    """Force-terminate a DataLoader's worker subprocesses.

    Ultralytics' InfiniteDataLoader (used for trainer.train_loader/test_loader) spawns its
    worker pool once and keeps it alive on self.iterator for the whole training run so
    epochs can reuse the workers. Normally those processes only die when the iterator is
    garbage-collected, but the backend is a long-lived process and the trainer/model graph
    is full of reference cycles, so that GC can be delayed indefinitely — leaving zombie
    python.exe children behind after every run. Shutting the workers down explicitly avoids
    depending on GC timing.
    """
    iterator = getattr(loader, "iterator", None)
    if iterator is not None and hasattr(iterator, "_shutdown_workers"):
        iterator._shutdown_workers()


def run_training(job_id: str, req: TrainRequest) -> None:
    from ultralytics import YOLO

    data_yaml = yolo_service.get_data_yaml_path(req.dataset)
    if not data_yaml.exists():
        raise AppError(f"Dataset '{req.dataset}' has no data.yaml")

    if req.device != "cpu":
        import torch

        if not torch.cuda.is_available():
            raise AppError("GPU was requested but torch reports no CUDA device is available")

    resume_in_place = False
    if req.resume_run:
        checkpoint = RUNS_DIR / req.resume_run / "weights" / f"{req.resume_weights}.pt"
        if not checkpoint.exists():
            raise AppError(f"No '{req.resume_weights}.pt' checkpoint found for run '{req.resume_run}'")
        resume_in_place = req.resume_weights == "last"
        job_service.mark_running(job_id, "Loading checkpoint...")
        model = YOLO(str(checkpoint))
    else:
        job_service.mark_running(job_id, "Loading model...")
        model = YOLO(f"{req.model}.pt")

    run_name = req.resume_run if resume_in_place else f"{req.dataset}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}"
    epoch_state = {"batch": 0, "total_batches": 0, "start_time": 0.0}

    def on_pretrain_routine_end(trainer):
        _active_trainers[job_id] = trainer
        device_str = str(trainer.device)
        job_service.set_device_used(job_id, device_str)
        wants_gpu = req.device != "cpu"
        if wants_gpu and not device_str.startswith("cuda"):
            raise AppError(
                f"Requested GPU training but ultralytics resolved the device to '{device_str}' instead of cuda. "
                "Another Python environment without CUDA torch may be handling this request."
            )

    def on_train_epoch_start(trainer):
        epoch_state["batch"] = 0
        epoch_state["total_batches"] = len(trainer.train_loader)
        epoch_state["start_time"] = time.time()

    def on_train_batch_end(trainer):
        if trainer.tloss is None:
            return
        epoch_state["batch"] += 1
        elapsed = time.time() - epoch_state["start_time"]
        speed = epoch_state["batch"] / elapsed if elapsed > 0 else 0.0
        images_done = min(epoch_state["batch"] * trainer.batch_size, len(trainer.train_loader.dataset))
        images_total = len(trainer.train_loader.dataset)
        train_losses = trainer.label_loss_items(trainer.tloss, prefix="train")
        epoch = min(trainer.epoch + 1, trainer.epochs)
        job_service.set_batch_progress(job_id, {
            "epoch": epoch,
            "total_epochs": trainer.epochs,
            "batch": epoch_state["batch"],
            "total_batches": epoch_state["total_batches"],
            "images_done": images_done,
            "images_total": images_total,
            "speed_it_s": round(speed, 2),
            "losses": {k: float(v) for k, v in train_losses.items()},
        })
        parts = ", ".join(f"{k.split('/')[-1]}={v:.3f}" for k, v in train_losses.items())
        job_service.mark_running(
            job_id,
            f"Epoch {epoch}/{trainer.epochs} — batch {epoch_state['batch']}/{epoch_state['total_batches']} "
            f"({images_done}/{images_total} imgs, {speed:.1f} it/s) — {parts}",
        )

    def on_fit_epoch_end(trainer):
        epoch = min(trainer.epoch + 1, trainer.epochs)
        train_losses = trainer.label_loss_items(trainer.tloss, prefix="train") if trainer.tloss is not None else {}
        metric = {
            "epoch": epoch,
            **{k: float(v) for k, v in train_losses.items()},
            **{k: float(v) for k, v in trainer.metrics.items()},
        }
        job_service.append_metric(job_id, metric)
        cb = job_service.make_progress_callback(job_id)
        cb(epoch, trainer.epochs, f"Epoch {epoch}/{trainer.epochs} complete")

    model.add_callback("on_pretrain_routine_end", on_pretrain_routine_end)
    model.add_callback("on_train_epoch_start", on_train_epoch_start)
    model.add_callback("on_train_batch_end", on_train_batch_end)
    model.add_callback("on_fit_epoch_end", on_fit_epoch_end)

    try:
        if resume_in_place:
            # Resuming an interrupted run: ultralytics reloads the original run's saved args
            # (data/batch/imgsz/lr0/etc.) from the checkpoint itself and continues in the same
            # run directory, so passing those again would be ignored/conflicting. Only the
            # epoch target is safe to extend.
            model.train(resume=True, epochs=req.epochs)
        else:
            model.train(
                data=str(data_yaml),
                epochs=req.epochs,
                batch=req.batch,
                imgsz=req.imgsz,
                device=req.device,
                project=str(RUNS_DIR),
                name=run_name,
                exist_ok=True,
                workers=4,
                lr0=req.lr0,
                patience=req.patience,
            )
    finally:
        trainer = _active_trainers.pop(job_id, None)
        stopped_early = job_id in _stop_requested
        _stop_requested.discard(job_id)
        if trainer is not None:
            for loader in (getattr(trainer, "train_loader", None), getattr(trainer, "test_loader", None)):
                if loader is not None:
                    _shutdown_loader_workers(loader)

    run_dir = RUNS_DIR / run_name
    best_weights = run_dir / "weights" / "best.pt"
    job_service.mark_completed(
        job_id,
        result={
            "run_name": run_name,
            "weights_path": str(best_weights) if best_weights.exists() else None,
            "run_dir": str(run_dir),
        },
        message="Training stopped early" if stopped_early else "Training complete",
    )
