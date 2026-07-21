import random
import shutil

from app.config import DATASETS_DIR, SPLITS
from app.services import merge_service, metadata_service, yolo_service
from app.services.logging_service import log_event
from app.utils.errors import AppError, DatasetNotFoundError, DuplicateDatasetNameError
from app.utils.file_ops import iter_image_files


def create_dataset(
    source: str,
    new_name: str,
    prefix: str,
    splits_to_include: list[str],
    progress_cb=None,
    class_filter: dict[int, str] | None = None,
) -> dict:
    dest_path = DATASETS_DIR / new_name
    if dest_path.exists():
        raise DuplicateDatasetNameError(f"Dataset '{new_name}' already exists")

    yolo_service.ensure_dataset_structure(new_name)
    result = merge_service.merge_dataset(
        source, new_name, prefix, splits_to_include, progress_cb=progress_cb, class_filter=class_filter
    )

    metadata_service.record_history_event(new_name, {
        "event": "created",
        "source_dataset": source,
        "prefix": prefix,
        "images_added": result["images_copied"],
        "images_skipped": result["images_skipped"],
        "splits": result["split_counts"],
    })
    log_event("dataset_created", f"Created dataset '{new_name}' from '{source}' with prefix '{prefix}'", dataset=new_name, source=source, count=result["images_copied"])
    refresh_cached_summary(new_name)
    return result


def _compute_summary_from_disk(name: str) -> dict:
    """One real filesystem walk (splits + size, in a single pass per split instead of two)."""
    path = yolo_service.dataset_path(name)
    splits: dict[str, int] = {}
    size_bytes = 0
    for split in SPLITS:
        images_dir = path / split / "images"
        labels_dir = path / split / "labels"
        count = 0
        for img in iter_image_files(images_dir):
            count += 1
            size_bytes += img.stat().st_size
        if labels_dir.exists():
            for lbl in labels_dir.iterdir():
                if lbl.is_file():
                    size_bytes += lbl.stat().st_size
        splits[split] = count
    classes = yolo_service.get_classes(name)
    return {
        "splits": splits,
        "total_images": sum(splits.values()),
        "num_classes": len(classes),
        "size_bytes": size_bytes,
    }


def refresh_cached_summary(name: str) -> dict:
    """Recomputes and persists the cached summary. Call after any operation that changes a
    dataset's files (create/merge/delete) so future reads stay fast without going stale."""
    summary = _compute_summary_from_disk(name)
    metadata_service.set_cached_summary(name, summary)
    return summary


def adjust_cached_summary(name: str, split: str, image_delta: int, size_delta: int) -> dict:
    """Applies a small known delta (e.g. one image+label removed) to the existing cached
    summary instead of recomputing it from scratch. _compute_summary_from_disk stats every file
    in the dataset to total up size_bytes — fine for a bulk operation done once, but deleting a
    single image from the UI was calling refresh_cached_summary() on every click, which measured
    ~2s on a ~5500-image dataset just to account for one file going away. Falls back to a full
    recompute if there's no cached summary yet to adjust."""
    cached = metadata_service.get_cached_summary(name)
    if cached is None:
        return refresh_cached_summary(name)

    splits = dict(cached.get("splits", {}))
    splits[split] = max(0, splits.get(split, 0) + image_delta)
    summary = {
        "splits": splits,
        "total_images": max(0, cached.get("total_images", 0) + image_delta),
        "num_classes": cached.get("num_classes", 0),
        "size_bytes": max(0, cached.get("size_bytes", 0) + size_delta),
    }
    metadata_service.set_cached_summary(name, summary)
    return summary


def _get_or_build_cached_summary(name: str) -> dict:
    cached = metadata_service.get_cached_summary(name)
    if cached is not None:
        return cached
    # First time we've ever looked at this dataset (e.g. a raw source folder dropped into
    # datasets/ that the app hasn't touched yet) — compute once and cache for next time.
    return refresh_cached_summary(name)


def list_datasets() -> list[dict]:
    summaries = []
    for name in yolo_service.list_dataset_names():
        summaries.append(get_dataset_summary(name))
    return summaries


def get_dataset_summary(name: str) -> dict:
    path = yolo_service.dataset_path(name)
    if not path.exists():
        raise DatasetNotFoundError(f"Dataset '{name}' not found")
    cached = _get_or_build_cached_summary(name)
    meta = metadata_service.load_metadata(name)
    return {
        "name": name,
        "splits": cached["splits"],
        "total_images": cached["total_images"],
        "num_classes": cached["num_classes"],
        "last_modified": meta.get("updated_at"),
        "size_bytes": cached["size_bytes"],
    }


def get_dataset_detail(name: str) -> dict:
    path = yolo_service.dataset_path(name)
    if not path.exists():
        raise DatasetNotFoundError(f"Dataset '{name}' not found")
    cached = _get_or_build_cached_summary(name)
    classes = yolo_service.get_classes(name)
    meta = metadata_service.load_metadata(name)
    return {
        "name": name,
        "splits": cached["splits"],
        "total_images": cached["total_images"],
        "classes": classes,
        "last_modified": meta.get("updated_at"),
        "size_bytes": cached["size_bytes"],
        "history": meta.get("history", []),
    }


def resplit_dataset(name: str, train_ratio: float, valid_ratio: float, test_ratio: float) -> dict:
    """Pools every image currently in the dataset (regardless of its current split), shuffles,
    and redistributes across train/valid/test by the given ratios — moving both the image and
    its label file. Re-running this reshuffles from scratch; it's not additive."""
    total_ratio = train_ratio + valid_ratio + test_ratio
    if abs(total_ratio - 1.0) > 0.01:
        raise AppError(f"Split ratios must sum to 1.0 (got {total_ratio:.2f})")

    path = yolo_service.dataset_path(name)
    if not path.exists():
        raise DatasetNotFoundError(f"Dataset '{name}' not found")

    all_items = []
    for split in SPLITS:
        for img in iter_image_files(path / split / "images"):
            all_items.append((split, img))

    if not all_items:
        raise AppError(f"Dataset '{name}' has no images to split")

    random.shuffle(all_items)
    total = len(all_items)
    n_train = round(total * train_ratio)
    n_valid = round(total * valid_ratio)
    # Remainder (not a fresh round()) so the three counts always sum to exactly `total`.
    buckets = (
        [("train", item) for item in all_items[:n_train]]
        + [("valid", item) for item in all_items[n_train:n_train + n_valid]]
        + [("test", item) for item in all_items[n_train + n_valid:]]
    )

    new_counts = {"train": 0, "valid": 0, "test": 0}
    for target_split, (current_split, img_path) in buckets:
        if target_split != current_split:
            label_path = path / current_split / "labels" / f"{img_path.stem}.txt"
            new_img_path = path / target_split / "images" / img_path.name
            new_label_path = path / target_split / "labels" / f"{img_path.stem}.txt"
            new_img_path.parent.mkdir(parents=True, exist_ok=True)
            new_label_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(img_path), str(new_img_path))
            if label_path.exists():
                shutil.move(str(label_path), str(new_label_path))
        new_counts[target_split] += 1

    refresh_cached_summary(name)
    metadata_service.record_history_event(name, {"event": "resplit", "splits": new_counts})
    log_event("dataset_resplit", f"Re-split '{name}' into {new_counts}", dataset=name)
    return {"splits": new_counts, "total_images": total}


def delete_dataset(name: str) -> None:
    import shutil
    path = yolo_service.dataset_path(name)
    if not path.exists():
        raise DatasetNotFoundError(f"Dataset '{name}' not found")
    shutil.rmtree(path)
    meta_path = metadata_service._metadata_path(name)
    if meta_path.exists():
        meta_path.unlink()
    log_event("dataset_deleted", f"Deleted dataset '{name}'", dataset=name)
