"""Fold a SAM3 export into a Dataset Manager dataset.

SAM3 writes YOLO-seg polygons; every dataset here is box-detection. Conversion has to happen
BEFORE the merge, not during it: merge_service.rewrite_label_class_ids only rewrites tokens[0]
and rejoins the rest verbatim, so it would copy polygon lines straight into a box dataset.

So this stages a converted copy first, then hands that to the existing merge, which keeps all
of the numbering, class-unification, metadata and cache-refresh behaviour for free. Images are
hardlinked into staging where the filesystem allows it, so a multi-GB export is not copied twice.
"""
import os
import shutil
import time
from pathlib import Path

from app.config import ROOT_DIR, SAM3_STAGING_DIR, SPLITS
from app.services import merge_service
from app.utils.errors import AppError
from app.utils.file_ops import iter_image_files, validate_safe_name
from app.utils.seg_to_box import convert_label_file
from app.utils.yaml_io import load_data_yaml, save_data_yaml


def _resolve_export(export_dir: str) -> Path:
    # A relative path is resolved against the project root, not uvicorn's working directory
    # (which is backend/). Every other path in this app is root-relative, and resolving against
    # the CWD would make the same input mean different things depending on how the server started.
    path = Path(export_dir).expanduser()
    if not path.is_absolute():
        path = ROOT_DIR / path
    if not path.is_dir():
        raise AppError(f"No such SAM3 export directory: {path}")
    if not (path / "data.yaml").exists():
        raise AppError(
            f"{path} has no data.yaml, so it is not a SAM3 export. Run Export first.",
            details={"export_dir": str(path)},
        )
    return path


def describe_export(export_dir: str) -> dict:
    """Summarize an export so the UI can show what a merge would bring in."""
    path = _resolve_export(export_dir)
    counts = {
        split: sum(1 for _ in iter_image_files(path / split / "images"))
        for split in SPLITS
    }
    return {
        "export_dir": str(path),
        "classes": load_data_yaml(path / "data.yaml")["classes"],
        "split_counts": counts,
        "total_images": sum(counts.values()),
    }


def _link_or_copy(src: Path, dst: Path) -> None:
    """Hardlink when possible, copy otherwise. Staging exists only to be merged out of, so a
    hardlink is enough and avoids duplicating image bytes for a large export."""
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def _stage(export_path: Path, splits_to_include: list[str]) -> tuple[Path, int, int]:
    """Build a box-format copy of the export. Returns (staging_dir, converted, skipped)."""
    staging = SAM3_STAGING_DIR / f"{export_path.name}_{int(time.time())}"
    converted = skipped = 0
    for split in splits_to_include:
        images_dir = export_path / split / "images"
        labels_dir = export_path / split / "labels"
        out_images = staging / split / "images"
        out_labels = staging / split / "labels"
        out_images.mkdir(parents=True, exist_ok=True)
        out_labels.mkdir(parents=True, exist_ok=True)
        for img in iter_image_files(images_dir):
            _link_or_copy(img, out_images / img.name)
            n_written, n_skipped = convert_label_file(
                labels_dir / f"{img.stem}.txt", out_labels / f"{img.stem}.txt"
            )
            converted += n_written
            skipped += n_skipped

    # The class list is authoritative from the export's own data.yaml, never from what was
    # detected -- a class that found nothing still has to hold its index.
    save_data_yaml(staging / "data.yaml", load_data_yaml(export_path / "data.yaml")["classes"])
    return staging, converted, skipped


def import_sam3_export(
    export_dir: str,
    destination: str,
    prefix: str,
    splits_to_include: list[str],
    progress_cb=None,
    class_filter: dict[int, str] | None = None,
) -> dict:
    invalid = [s for s in splits_to_include if s not in SPLITS]
    if invalid:
        raise AppError(f"Invalid split(s): {invalid}", details={"valid_splits": list(SPLITS)})
    validate_safe_name(destination, "dataset name")
    validate_safe_name(prefix, "prefix")
    export_path = _resolve_export(export_dir)

    if progress_cb:
        progress_cb(0, 1, "Converting polygon labels to boxes...")
    staging, converted, skipped = _stage(export_path, splits_to_include)
    try:
        result = merge_service.merge_dataset(
            staging.name,
            destination,
            prefix,
            splits_to_include,
            progress_cb=progress_cb,
            class_filter=class_filter,
            source_root=staging.parent,
        )
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    return {**result, "labels_converted": converted, "lines_skipped": skipped,
            "export_dir": str(export_path)}
