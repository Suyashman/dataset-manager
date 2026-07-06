import shutil

from app.config import PAD_WIDTH
from app.schemas.augmentation import AugTechniqueConfig
from app.services import metadata_service, yolo_service
from app.services.logging_service import log_event
from app.utils.augment_utils import TECHNIQUE_PREFIXES, TECHNIQUES
from app.utils.errors import DuplicateDatasetNameError
from app.utils.file_ops import iter_image_files
from app.utils.numbering import zero_pad


def _params_for(tech: AugTechniqueConfig) -> dict:
    return {
        "angle_range": tech.angle_range,
        "hsv_h": tech.hsv_h,
        "hsv_s": tech.hsv_s,
        "hsv_v": tech.hsv_v,
        "blur_kernel_range": tech.blur_kernel_range,
        "noise_sigma_range": tech.noise_sigma_range,
    }


def augment_dataset(
    source: str,
    destination: str,
    techniques: list[AugTechniqueConfig],
    progress_cb=None,
) -> dict:
    """Clones `source` into a brand-new `destination` dataset (all splits, untouched), then adds
    augmented variants of every train-split image into destination's train split only — valid/test
    are never augmented so evaluation metrics stay honest."""
    src_path = yolo_service.validate_source_dataset(source)
    dest_path = yolo_service.dataset_path(destination)
    if dest_path.exists():
        raise DuplicateDatasetNameError(f"Dataset '{destination}' already exists")

    shutil.copytree(src_path, dest_path)
    metadata_service.clone_metadata(source, destination)

    images_dir = dest_path / "train" / "images"
    labels_dir = dest_path / "train" / "labels"
    # Snapshot the file list before writing any augmented output into this same folder.
    source_images = list(iter_image_files(images_dir))

    total = sum(t.copies for t in techniques) * len(source_images)
    processed = 0
    counts_by_technique: dict[str, int] = {}
    dropped_boxes = 0

    for tech in techniques:
        fn = TECHNIQUES[tech.type]
        prefix = TECHNIQUE_PREFIXES[tech.type]
        params = _params_for(tech)

        for img_file in source_images:
            label_file = labels_dir / (img_file.stem + ".txt")
            for _ in range(tech.copies):
                number = metadata_service.get_next_number(destination, prefix, PAD_WIDTH)
                new_stem = f"{prefix}{zero_pad(number)}"
                out_img = images_dir / f"{new_stem}{img_file.suffix.lower()}"
                out_label = labels_dir / f"{new_stem}.txt"

                dropped_boxes += fn(img_file, label_file, out_img, out_label, params)
                counts_by_technique[tech.type] = counts_by_technique.get(tech.type, 0) + 1

                processed += 1
                if progress_cb and (processed % 10 == 0 or processed == total):
                    progress_cb(processed, total, f"{tech.type}: {processed}/{total}")

    images_added = sum(counts_by_technique.values())
    metadata_service.update_split_counts(destination, {"train": images_added})

    from app.services import dataset_service
    dataset_service.refresh_cached_summary(destination)

    metadata_service.record_history_event(destination, {
        "event": "augmented",
        "source_dataset": source,
        "techniques": counts_by_technique,
        "images_added": images_added,
        "dropped_boxes": dropped_boxes,
    })
    log_event(
        "dataset_augmented",
        f"Augmented '{destination}' from '{source}': {images_added} images added across {len(techniques)} technique(s)",
        dataset=destination,
        source=source,
        count=images_added,
    )

    return {
        "destination": destination,
        "source": source,
        "images_added": images_added,
        "techniques": counts_by_technique,
        "dropped_boxes": dropped_boxes,
    }
