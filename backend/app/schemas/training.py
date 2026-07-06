from typing import Literal

from pydantic import BaseModel, Field

MODEL_VARIANTS = ("yolov8n", "yolov8s", "yolov8m", "yolov8l", "yolov8x")


class TrainRequest(BaseModel):
    dataset: str
    model: str = "yolov8n"
    epochs: int = Field(50, gt=0, le=10000)
    batch: int = Field(16, gt=0, le=1024)
    imgsz: int = Field(640, gt=0, le=4096)
    device: str = "cpu"  # "cpu" or a CUDA device index as a string, e.g. "0"
    lr0: float = Field(0.01, gt=0)
    patience: int = Field(100, ge=0)
    # If set, starts from a previous run's checkpoint instead of a stock pretrained model.
    # "best" fine-tunes into a new run; "last" resumes the original (interrupted) run in place.
    resume_run: str | None = None
    resume_weights: Literal["best", "last"] = "best"


class DeviceInfo(BaseModel):
    cuda_available: bool
    device_name: str | None = None
    cpu_name: str


class TrainingRun(BaseModel):
    run_name: str
    dataset: str | None
    has_best: bool
    has_last: bool
    completed_epochs: int
    total_epochs: int | None
    is_interrupted: bool
