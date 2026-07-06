from pathlib import Path

from app.config import DATASETS_DIR, SPLITS
from app.utils.errors import InvalidYoloStructureError
from app.utils.file_ops import iter_image_files, validate_safe_name
from app.utils.yaml_io import load_data_yaml


def dataset_path(name: str) -> Path:
    validate_safe_name(name, "dataset name")
    return DATASETS_DIR / name


def validate_source_dataset(name: str) -> Path:
    path = dataset_path(name)
    if not path.exists() or not path.is_dir():
        raise InvalidYoloStructureError(f"Dataset folder '{name}' does not exist under datasets/")
    found_any_split = False
    for split in SPLITS:
        images_dir = path / split / "images"
        if images_dir.exists():
            found_any_split = True
    if not found_any_split:
        raise InvalidYoloStructureError(
            f"Dataset '{name}' has no train/valid/test images/ folders. Expected YOLO structure with at least one split."
        )
    return path


def get_data_yaml_path(name: str) -> Path:
    return dataset_path(name) / "data.yaml"


def get_classes(name: str) -> dict[int, str]:
    return load_data_yaml(get_data_yaml_path(name))["classes"]


def count_split_images(name: str) -> dict[str, int]:
    path = dataset_path(name)
    counts = {}
    for split in SPLITS:
        images_dir = path / split / "images"
        counts[split] = sum(1 for _ in iter_image_files(images_dir))
    return counts


def list_dataset_names() -> list[str]:
    if not DATASETS_DIR.exists():
        return []
    return sorted([p.name for p in DATASETS_DIR.iterdir() if p.is_dir()])


def ensure_dataset_structure(name: str) -> None:
    path = dataset_path(name)
    for split in SPLITS:
        (path / split / "images").mkdir(parents=True, exist_ok=True)
        (path / split / "labels").mkdir(parents=True, exist_ok=True)
