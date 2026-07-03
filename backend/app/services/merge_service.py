import time
from pathlib import Path

from app.config import PAD_WIDTH
from app.services import metadata_service, yolo_service
from app.services.logging_service import log_event
from app.utils.file_ops import copy_file_safe, iter_image_files
from app.utils.label_utils import rewrite_label_class_ids
from app.utils.numbering import zero_pad
from app.utils.yaml_io import load_data_yaml, save_data_yaml

_COPY_RETRY_ATTEMPTS = 3
_COPY_RETRY_DELAY_SECONDS = 0.2


def _copy_with_retry(src: Path, dst: Path) -> None:
    """Copies a file, retrying on transient OS errors (e.g. a brief AV-scan lock on Windows)
    instead of dropping the file on the first hiccup."""
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


def merge_class_mappings(
    src_classes: dict[int, str],
    dest_classes: dict[int, str],
    class_filter: dict[int, str] | None = None,
) -> tuple[dict[int, int], dict[int, str], set[int]]:
    """Returns (remap: old_src_id -> new_id, unified_mapping: new_id -> name, drop_classes: old_src_ids to discard).

    `class_filter`, if given, restricts which source classes are kept (others go into
    `drop_classes` and every box of that class is removed from the copied labels) and lets the
    caller rename a kept class on the way in, e.g. {3: "vest"} to keep only source class 3
    ('reflective') and rename it to 'vest'.
    """
    dest_name_to_id = {name: cid for cid, name in dest_classes.items()}
    unified_mapping = dict(dest_classes)
    remap: dict[int, int] = {}
    drop_classes: set[int] = set()

    keep_ids = set(class_filter.keys()) if class_filter is not None else set(src_classes.keys())

    for src_id in sorted(src_classes.keys()):
        if src_id not in keep_ids:
            drop_classes.add(src_id)
            continue
        name = class_filter[src_id] if class_filter is not None else src_classes[src_id]
        if name in dest_name_to_id:
            remap[src_id] = dest_name_to_id[name]
        else:
            new_id = (max(dest_name_to_id.values()) + 1) if dest_name_to_id else 0
            dest_name_to_id[name] = new_id
            unified_mapping[new_id] = name
            remap[src_id] = new_id

    return remap, unified_mapping, drop_classes


def merge_dataset(
    source: str,
    destination: str,
    prefix: str,
    splits_to_include: list[str],
    progress_cb=None,
    class_filter: dict[int, str] | None = None,
) -> dict:
    """Copies+renames images/labels from source into destination, remapping class ids.
    Used directly for both 'create' (destination starts empty) and 'merge' flows.

    `class_filter`, if given, keeps only the listed source class ids (optionally renamed) and
    strips every label line for any other class out of the copied label files.
    """
    src_path = yolo_service.validate_source_dataset(source)
    yolo_service.ensure_dataset_structure(destination)
    dest_path = yolo_service.dataset_path(destination)

    src_yaml = load_data_yaml(src_path / "data.yaml")
    dest_yaml = load_data_yaml(dest_path / "data.yaml")
    src_classes = src_yaml["classes"]
    dest_classes = dest_yaml["classes"]

    remap, unified_mapping, drop_classes = merge_class_mappings(src_classes, dest_classes, class_filter)

    # gather all files to process first so we know the total for progress reporting
    work_items = []
    for split in splits_to_include:
        images_dir = src_path / split / "images"
        labels_dir = src_path / split / "labels"
        for img_file in iter_image_files(images_dir):
            label_file = labels_dir / (img_file.stem + ".txt")
            work_items.append((split, img_file, label_file))

    total = len(work_items)
    split_counts = {"train": 0, "valid": 0, "test": 0}
    errors = []
    processed = 0

    for split, img_file, label_file in work_items:
        try:
            number = metadata_service.get_next_number(destination, prefix, PAD_WIDTH)
            new_stem = f"{prefix}{zero_pad(number)}"
            new_img_path = dest_path / split / "images" / f"{new_stem}{img_file.suffix.lower()}"
            new_label_path = dest_path / split / "labels" / f"{new_stem}.txt"

            _copy_with_retry(img_file, new_img_path)
            warnings = rewrite_label_class_ids(label_file, new_label_path, remap, drop_classes)
            for w in warnings:
                errors.append({"file": str(img_file.name), "reason": w})

            split_counts[split] = split_counts.get(split, 0) + 1
        except Exception as e:
            errors.append({"file": str(img_file.name), "reason": str(e)})

        processed += 1
        if progress_cb and (processed % 25 == 0 or processed == total):
            progress_cb(processed, total, f"Processed {processed}/{total} files")

    images_copied = sum(split_counts.values())
    skipped = total - images_copied

    save_data_yaml(dest_path / "data.yaml", unified_mapping)
    metadata_service.update_class_mapping(
        destination,
        unified_mapping,
        {"dataset": source, "original_mapping": {str(k): v for k, v in src_classes.items()}},
    )
    metadata_service.update_split_counts(destination, split_counts)
    # Local import avoids a circular import (dataset_service imports this module at top level).
    from app.services import dataset_service
    dataset_service.refresh_cached_summary(destination)
    metadata_service.record_history_event(destination, {
        "event": "merged",
        "source_dataset": source,
        "prefix": prefix,
        "images_added": images_copied,
        "images_skipped": skipped,
        "splits": split_counts,
        "class_remap": {"old": {str(k): v for k, v in src_classes.items()}, "new": {str(k): v for k, v in unified_mapping.items()}},
        "dropped_classes": {str(k): src_classes[k] for k in sorted(drop_classes)} if drop_classes else None,
        # Cap stored errors so metadata.json doesn't blow up on a pathological run.
        "errors": errors[:50] if errors else None,
    })

    if skipped:
        log_event(
            "dataset_merge_partial_failure",
            f"Merged {images_copied}/{total} files from '{source}' into '{destination}' with prefix '{prefix}' — {skipped} file(s) skipped due to errors",
            dataset=destination,
            source=source,
            count=images_copied,
            skipped=skipped,
            errors=errors,
            level="WARNING",
        )
    else:
        log_event(
            "dataset_merged",
            f"Merged {images_copied} files from '{source}' into '{destination}' with prefix '{prefix}'",
            dataset=destination,
            source=source,
            count=images_copied,
        )

    return {
        "destination": destination,
        "source": source,
        "total_processed": total,
        "images_copied": images_copied,
        "images_skipped": skipped,
        "split_counts": split_counts,
        "errors": errors,
        "unified_classes": {str(k): v for k, v in unified_mapping.items()},
    }


def merge_multiple(
    destination: str,
    sources: list[dict],
    splits_to_include: list[str],
    progress_cb=None,
) -> dict:
    """Merges several source datasets into one destination in a single operation, one source at
    a time, in the order given. The destination can be brand new or already exist — there's no
    separate 'create' step needed when combining multiple Roboflow exports into one master.

    `sources` is a list of {"source": str, "prefix": str, "class_filter": dict[int,str]|None}.
    Each source needs its own prefix so filenames never collide across sources.
    """
    yolo_service.ensure_dataset_structure(destination)

    # Precompute total work across every source up front so progress reporting is one smooth
    # bar across the whole multi-dataset merge, not N separate 0-100% bars.
    per_source_totals = []
    grand_total = 0
    for entry in sources:
        src_path = yolo_service.validate_source_dataset(entry["source"])
        n = sum(
            sum(1 for _ in iter_image_files(src_path / split / "images"))
            for split in splits_to_include
        )
        per_source_totals.append(n)
        grand_total += n

    completed_before = 0
    per_source_results = []
    for entry, src_total in zip(sources, per_source_totals):
        def cb(current, _total, message, _completed_before=completed_before, _src=entry["source"]):
            if progress_cb:
                progress_cb(_completed_before + current, grand_total, f"[{_src}] {message}")

        result = merge_dataset(
            entry["source"],
            destination,
            entry["prefix"],
            splits_to_include,
            progress_cb=cb,
            class_filter=entry.get("class_filter"),
        )
        per_source_results.append(result)
        completed_before += src_total

    return {
        "destination": destination,
        "sources": [r["source"] for r in per_source_results],
        "images_copied": sum(r["images_copied"] for r in per_source_results),
        "images_skipped": sum(r["images_skipped"] for r in per_source_results),
        "per_source": per_source_results,
        "unified_classes": per_source_results[-1]["unified_classes"] if per_source_results else {},
    }
