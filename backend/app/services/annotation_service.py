import time
from pathlib import Path

from app.config import PAD_WIDTH, SPLITS
from app.services import metadata_service, yolo_service
from app.services.logging_service import log_event
from app.utils.errors import AppError, DuplicateDatasetNameError
from app.utils.file_ops import copy_file_safe, iter_image_files, safe_path_join, validate_safe_name
from app.utils.numbering import zero_pad
from app.utils.yaml_io import load_data_yaml, save_data_yaml

_COPY_RETRY_ATTEMPTS = 3
_COPY_RETRY_DELAY_SECONDS = 0.2


def _copy_with_retry(src: Path, dst: Path) -> None:
    last_error: Exception | None = None
    for attempt in range(_COPY_RETRY_ATTEMPTS):
        try:
            copy_file_safe(src, dst)
            return
        except OSError as e:
            last_error = e
            if attempt < _COPY_RETRY_ATTEMPTS - 1:
                time.sleep(_COPY_RETRY_DELAY_SECONDS)
    raise last_error


def create_empty_dataset(name: str) -> None:
    path = yolo_service.dataset_path(name)
    if path.exists():
        raise DuplicateDatasetNameError(f"Dataset '{name}' already exists")
    yolo_service.ensure_dataset_structure(name)
    save_data_yaml(yolo_service.get_data_yaml_path(name), {})
    metadata_service.record_history_event(name, {"event": "created_empty"})
    from app.services import dataset_service
    dataset_service.refresh_cached_summary(name)
    log_event("dataset_created", f"Created empty dataset '{name}' for manual annotation", dataset=name)


def create_from_reference(source: str, destination: str) -> None:
    """Starts a new, empty dataset that carries over the reference dataset's class list, so
    new annotations stay compatible with it — without ever writing into the reference itself."""
    dest_path = yolo_service.dataset_path(destination)
    if dest_path.exists():
        raise DuplicateDatasetNameError(f"Dataset '{destination}' already exists")
    if not yolo_service.dataset_path(source).exists():
        raise AppError(f"Reference dataset '{source}' not found")

    yolo_service.ensure_dataset_structure(destination)
    save_data_yaml(yolo_service.get_data_yaml_path(destination), yolo_service.get_classes(source))
    metadata_service.record_history_event(destination, {"event": "forked_from", "source_dataset": source})
    from app.services import dataset_service
    dataset_service.refresh_cached_summary(destination)
    log_event("dataset_created", f"Created '{destination}' from reference '{source}' for manual annotation", dataset=destination)


def import_folder(dataset: str, folder_path: str, split: str, prefix: str) -> dict:
    if split not in SPLITS:
        raise AppError(f"Invalid split '{split}'", details={"valid_splits": list(SPLITS)})
    validate_safe_name(prefix, "prefix")
    src = Path(folder_path)
    if not src.exists() or not src.is_dir():
        raise AppError(f"Folder not found or not a directory: {folder_path}")

    yolo_service.ensure_dataset_structure(dataset)
    dest_path = yolo_service.dataset_path(dataset)
    images = list(iter_image_files(src))
    if not images:
        raise AppError(f"No supported image files found in {folder_path}")

    added = 0
    errors = []
    for img in images:
        try:
            number = metadata_service.get_next_number(dataset, prefix, PAD_WIDTH)
            new_name = f"{prefix}{zero_pad(number)}{img.suffix.lower()}"
            dest = dest_path / split / "images" / new_name
            _copy_with_retry(img, dest)
            added += 1
        except Exception as e:
            errors.append({"file": img.name, "reason": str(e)})

    metadata_service.update_split_counts(dataset, {split: added})
    from app.services import dataset_service
    dataset_service.refresh_cached_summary(dataset)
    metadata_service.record_history_event(dataset, {
        "event": "images_imported",
        "source_folder": folder_path,
        "prefix": prefix,
        "images_added": added,
        "images_skipped": len(errors),
        "splits": {split: added},
        "errors": errors[:50] if errors else None,
    })
    log_event("images_imported", f"Imported {added} image(s) from '{folder_path}' into '{dataset}'", dataset=dataset, count=added)

    return {"images_added": added, "images_skipped": len(errors), "errors": errors}


def add_class(dataset: str, name: str) -> int:
    name = name.strip()
    if not name:
        raise AppError("Class name cannot be empty")
    path = yolo_service.get_data_yaml_path(dataset)
    data = load_data_yaml(path)
    classes = data["classes"]
    for cid, cname in classes.items():
        if cname == name:
            return cid
    new_id = (max(classes.keys()) + 1) if classes else 0
    classes[new_id] = name
    save_data_yaml(path, classes)
    metadata_service.update_class_mapping(dataset, classes, {"event": "manual_add_class", "class": name})
    from app.services import dataset_service
    dataset_service.refresh_cached_summary(dataset)
    return new_id


def save_boxes(dataset: str, split: str, filename: str, boxes: list[dict]) -> None:
    if split not in SPLITS:
        raise AppError(f"Invalid split '{split}'", details={"valid_splits": list(SPLITS)})
    path = yolo_service.dataset_path(dataset)
    stem = filename.rsplit(".", 1)[0]
    label_path = safe_path_join(path, split, "labels", f"{stem}.txt")
    lines = [
        f"{b['class_id']} {b['x_center']:.6f} {b['y_center']:.6f} {b['width']:.6f} {b['height']:.6f}"
        for b in boxes
    ]
    label_path.parent.mkdir(parents=True, exist_ok=True)
    with open(label_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
        if lines:
            f.write("\n")


def delete_image(dataset: str, split: str, filename: str) -> dict:
    if split not in SPLITS:
        raise AppError(f"Invalid split '{split}'", details={"valid_splits": list(SPLITS)})
    path = yolo_service.dataset_path(dataset)
    img_path = safe_path_join(path, split, "images", filename)
    if not img_path.exists():
        raise AppError("Image not found", details={"file": filename})

    stem = filename.rsplit(".", 1)[0]
    label_path = safe_path_join(path, split, "labels", f"{stem}.txt")
    had_label = label_path.exists()

    size_delta = -img_path.stat().st_size
    if had_label:
        size_delta -= label_path.stat().st_size

    img_path.unlink()
    if had_label:
        label_path.unlink()

    metadata_service.update_split_counts(dataset, {split: -1})
    from app.services import dataset_service
    dataset_service.adjust_cached_summary(dataset, split, image_delta=-1, size_delta=size_delta)
    metadata_service.record_history_event(dataset, {
        "event": "image_deleted",
        "split": split,
        "filename": filename,
        "had_label": had_label,
    })
    log_event("image_deleted", f"Deleted image '{filename}' from '{dataset}/{split}'", dataset=dataset, count=1)

    return {"deleted": True, "filename": filename, "had_label": had_label}


def delete_orphan_label(dataset: str, split: str, filename: str) -> dict:
    """Removes a label file that has no matching image (the validation 'missing_images'
    case) — there's nothing to preview or re-annotate, just a stray .txt to clean up."""
    if split not in SPLITS:
        raise AppError(f"Invalid split '{split}'", details={"valid_splits": list(SPLITS)})
    path = yolo_service.dataset_path(dataset)
    label_path = safe_path_join(path, split, "labels", filename)
    if not label_path.exists():
        raise AppError("Label file not found", details={"file": filename})

    size_delta = -label_path.stat().st_size
    label_path.unlink()
    from app.services import dataset_service
    dataset_service.adjust_cached_summary(dataset, split, image_delta=0, size_delta=size_delta)
    metadata_service.record_history_event(dataset, {
        "event": "orphan_label_deleted",
        "split": split,
        "filename": filename,
    })
    log_event("orphan_label_deleted", f"Deleted orphan label '{filename}' from '{dataset}/{split}'", dataset=dataset, count=1)

    return {"deleted": True, "filename": filename}
