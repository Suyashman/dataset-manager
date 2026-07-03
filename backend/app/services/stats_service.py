from app.config import SPLITS
from app.services import validation_service, yolo_service
from app.utils.file_ops import iter_image_files
from app.utils.label_utils import parse_label_file


def compute_stats(dataset_name: str) -> dict:
    path = yolo_service.dataset_path(dataset_name)
    classes = yolo_service.get_classes(dataset_name)
    splits = {}
    total_images = 0
    num_labels = 0
    class_box_counts: dict[int, int] = {cid: 0 for cid in classes}

    for split in SPLITS:
        images = list(iter_image_files(path / split / "images"))
        labels_dir = path / split / "labels"
        labels = list(labels_dir.glob("*.txt")) if labels_dir.exists() else []
        splits[split] = {"images": len(images), "labels": len(labels)}
        total_images += len(images)
        num_labels += len(labels)
        for lbl in labels:
            for box in parse_label_file(lbl):
                class_box_counts[box["class_id"]] = class_box_counts.get(box["class_id"], 0) + 1

    report = validation_service.run_validation(dataset_name)
    summary = report["summary"]

    avg_images_per_class = (sum(class_box_counts.values()) / len(classes)) if classes else 0.0

    return {
        "dataset": dataset_name,
        "total_images": total_images,
        "splits": splits,
        "num_labels": num_labels,
        "num_classes": len(classes),
        "avg_images_per_class": avg_images_per_class,
        "missing_labels": summary.get("missing_labels", 0),
        "missing_images": summary.get("missing_images", 0),
        "duplicate_images": summary.get("duplicate_images", 0),
        "duplicate_labels": summary.get("duplicate_filenames", 0),
        "corrupted_files": summary.get("corrupted_images", 0),
        "empty_label_files": summary.get("empty_label_files", 0),
    }
