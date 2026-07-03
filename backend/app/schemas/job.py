from typing import Any, Literal

from pydantic import BaseModel, Field

JobStatusLiteral = Literal["pending", "running", "completed", "failed"]


class JobProgress(BaseModel):
    current: int = 0
    total: int = 0
    percent: float = 0.0


class JobStatus(BaseModel):
    job_id: str
    status: JobStatusLiteral = "pending"
    progress: JobProgress = JobProgress()
    message: str = ""
    result: dict[str, Any] | None = None
    error: str | None = None
    # Per-epoch training metrics, appended incrementally so the frontend can chart them live.
    metrics: list[dict[str, Any]] = Field(default_factory=list)
    # The actual torch device the training run resolved to (e.g. "cuda:0"), set once training
    # actually starts, so the UI can confirm the GPU/CPU choice was really honored.
    device_used: str | None = None
    # Within-epoch batch progress, updated every batch so the UI can mirror the terminal's
    # live tqdm bar (batch count, images processed, iterations/sec).
    batch_progress: dict[str, Any] | None = None
