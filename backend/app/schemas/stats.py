from pydantic import BaseModel


class SplitStats(BaseModel):
    images: int
    labels: int


class DatasetStats(BaseModel):
    dataset: str
    total_images: int
    splits: dict[str, SplitStats]
    num_labels: int
    num_classes: int
    avg_images_per_class: float
    missing_labels: int
    missing_images: int
    duplicate_images: int
    duplicate_labels: int
    corrupted_files: int
    empty_label_files: int
