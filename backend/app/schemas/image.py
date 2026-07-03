from pydantic import BaseModel


class ImageInfo(BaseModel):
    filename: str
    split: str
    resolution: tuple[int, int] | None
    has_label: bool
    box_count: int


class ImageListResponse(BaseModel):
    items: list[ImageInfo]
    total: int
    page: int
    page_size: int


class LabelBox(BaseModel):
    class_id: int
    class_name: str
    x_center: float
    y_center: float
    width: float
    height: float


class LabelResponse(BaseModel):
    boxes: list[LabelBox]
    raw_text: str
