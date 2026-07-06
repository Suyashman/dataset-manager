from pydantic import BaseModel


class CreateEmptyDatasetRequest(BaseModel):
    name: str


class CreateFromReferenceRequest(BaseModel):
    source: str
    destination: str


class ImportFolderRequest(BaseModel):
    folder_path: str
    split: str = "train"
    prefix: str


class ImportFolderResponse(BaseModel):
    images_added: int
    images_skipped: int
    errors: list[dict]


class AddClassRequest(BaseModel):
    name: str


class AddClassResponse(BaseModel):
    class_id: int
    name: str


class BoxIn(BaseModel):
    class_id: int
    x_center: float
    y_center: float
    width: float
    height: float


class SaveBoxesRequest(BaseModel):
    boxes: list[BoxIn]
