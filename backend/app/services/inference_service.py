import threading
import time
import uuid

import cv2
import numpy as np

from app.config import INFERENCE_DIR, RUNS_DIR
from app.utils.errors import AppError

_lock = threading.Lock()
_cache: dict[str, object] = {"key": None, "model": None}


def _checkpoint_path(run_name: str, weights: str) -> "object":
    from pathlib import Path

    path: Path = RUNS_DIR / run_name / "weights" / f"{weights}.pt"
    if not path.exists():
        raise AppError(f"No '{weights}.pt' checkpoint found for run '{run_name}'")
    return path


def get_model(run_name: str, weights: str, device: str):
    """Keeps the most-recently-used model loaded in memory. Reloading a checkpoint from disk
    costs ~1-2s, which would make webcam/video inference unusably slow if repeated per call."""
    from ultralytics import YOLO

    checkpoint = _checkpoint_path(run_name, weights)
    key = f"{checkpoint}|{device}"
    with _lock:
        if _cache["key"] != key:
            model = YOLO(str(checkpoint))
            _cache["key"] = key
            _cache["model"] = model
        return _cache["model"]


def _extract_boxes(result) -> list[dict]:
    boxes = []
    names = result.names
    if result.boxes is None:
        return boxes
    xywhn = result.boxes.xywhn.cpu().numpy()
    cls = result.boxes.cls.cpu().numpy()
    conf = result.boxes.conf.cpu().numpy()
    for i in range(len(cls)):
        class_id = int(cls[i])
        boxes.append({
            "class_id": class_id,
            "class_name": names.get(class_id, f"class_{class_id}"),
            "x_center": float(xywhn[i][0]),
            "y_center": float(xywhn[i][1]),
            "width": float(xywhn[i][2]),
            "height": float(xywhn[i][3]),
            "confidence": float(conf[i]),
        })
    return boxes


def _speed_info(result) -> dict:
    s = result.speed
    total = s["preprocess"] + s["inference"] + s["postprocess"]
    return {
        "preprocess_ms": round(s["preprocess"], 2),
        "inference_ms": round(s["inference"], 2),
        "postprocess_ms": round(s["postprocess"], 2),
        "total_ms": round(total, 2),
        "fps": round(1000 / total, 2) if total > 0 else 0.0,
    }


def _predict(model, image, device: str, conf: float, iou: float):
    with _lock:
        results = model.predict(source=image, conf=conf, iou=iou, device=device, verbose=False)
    return results[0]


def run_image_inference(model, image_bytes: bytes, device: str, conf: float, iou: float) -> dict:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise AppError("Could not decode image file")

    result = _predict(model, img, device, conf, iou)
    return {
        "boxes": _extract_boxes(result),
        "speed": _speed_info(result),
        "annotated": result.plot(),
    }


def run_webcam_frame(model, image_bytes: bytes, device: str, conf: float, iou: float) -> dict:
    """Same as run_image_inference but skips plotting/saving — the frontend already has the raw
    live video and only needs the box coordinates to draw its own overlay."""
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise AppError("Could not decode frame")

    result = _predict(model, img, device, conf, iou)
    return {"boxes": _extract_boxes(result), "speed": _speed_info(result)}


def new_batch_dir() -> tuple[str, "object"]:
    batch_id = uuid.uuid4().hex
    batch_dir = INFERENCE_DIR / batch_id
    batch_dir.mkdir(parents=True, exist_ok=True)
    return batch_id, batch_dir


def run_video_inference(job_id: str, model, video_path, device: str, conf: float, iou: float, frame_stride: int, progress_cb=None) -> dict:
    batch_id, batch_dir = new_batch_dir()
    out_path = batch_dir / "output.mp4"

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise AppError("Could not open video file")

    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0

    writer = cv2.VideoWriter(str(out_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))

    frame_idx = 0
    processed = 0
    total_detections = 0
    speed_samples: list[float] = []
    last_annotated = None

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        if frame_idx % frame_stride == 0:
            result = _predict(model, frame, device, conf, iou)
            last_annotated = result.plot()
            total_detections += len(_extract_boxes(result))
            speed_samples.append(result.speed["preprocess"] + result.speed["inference"] + result.speed["postprocess"])
            writer.write(last_annotated)
            processed += 1
        else:
            # Pass through un-annotated frames between processed ones so output stays full length.
            writer.write(last_annotated if last_annotated is not None else frame)

        frame_idx += 1
        if progress_cb and total_frames and (frame_idx % 10 == 0 or frame_idx == total_frames):
            progress_cb(frame_idx, total_frames, f"Frame {frame_idx}/{total_frames}")

    cap.release()
    writer.release()

    avg_ms = sum(speed_samples) / len(speed_samples) if speed_samples else 0.0
    return {
        "batch_id": batch_id,
        "output_filename": "output.mp4",
        "frames_total": frame_idx,
        "frames_processed": processed,
        "total_detections": total_detections,
        "avg_speed_ms": round(avg_ms, 2),
        "avg_fps": round(1000 / avg_ms, 2) if avg_ms > 0 else 0.0,
    }
