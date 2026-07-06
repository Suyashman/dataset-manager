from pydantic import BaseModel, Field


class CreateDatasetRequest(BaseModel):
    source: str
    new_name: str
    prefix: str
    splits_to_include: list[str] = ["train", "valid", "test"]
    # Maps source class id (as string, since JSON object keys are strings) -> desired output name.
    # Omitting a source class id drops every box of that class from the copied labels.
    # None (the default) keeps every class with its original name.
    class_filter: dict[str, str] | None = None


class MergeDatasetRequest(BaseModel):
    source: str
    destination: str
    prefix: str
    splits_to_include: list[str] = ["train", "valid", "test"]
    class_filter: dict[str, str] | None = None


class MergeSourceEntry(BaseModel):
    source: str
    prefix: str
    class_filter: dict[str, str] | None = None


class MergeMultiRequest(BaseModel):
    destination: str
    sources: list[MergeSourceEntry]
    splits_to_include: list[str] = ["train", "valid", "test"]


class ResplitRequest(BaseModel):
    train: float = Field(0.8, ge=0, le=1)
    valid: float = Field(0.2, ge=0, le=1)
    test: float = Field(0.0, ge=0, le=1)


class DatasetSummary(BaseModel):
    name: str
    splits: dict[str, int]
    total_images: int
    num_classes: int
    last_modified: str | None
    size_bytes: int


class DatasetDetail(BaseModel):
    name: str
    splits: dict[str, int]
    total_images: int
    classes: dict[int, str]
    last_modified: str | None
    size_bytes: int
    history: list[dict]
