from pydantic import BaseModel


class DetectionBox(BaseModel):
    class_id: int
    class_name: str
    x_center: float
    y_center: float
    width: float
    height: float
    confidence: float


class SpeedInfo(BaseModel):
    preprocess_ms: float
    inference_ms: float
    postprocess_ms: float
    total_ms: float
    fps: float


class ImageInferenceResult(BaseModel):
    filename: str
    boxes: list[DetectionBox]
    annotated_url: str
    speed: SpeedInfo


class MultiImageInferenceResponse(BaseModel):
    results: list[ImageInferenceResult]


class WebcamFrameResponse(BaseModel):
    boxes: list[DetectionBox]
    speed: SpeedInfo
