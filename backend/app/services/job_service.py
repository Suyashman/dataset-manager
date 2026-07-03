import threading
import uuid
from typing import Callable

from app.schemas.job import JobProgress, JobStatus
from app.utils.errors import JobNotFoundError

_jobs: dict[str, JobStatus] = {}
_guard = threading.Lock()


def create_job() -> str:
    job_id = uuid.uuid4().hex
    with _guard:
        _jobs[job_id] = JobStatus(job_id=job_id, status="pending")
    return job_id


def get_job(job_id: str) -> JobStatus:
    with _guard:
        job = _jobs.get(job_id)
    if job is None:
        raise JobNotFoundError(f"Job {job_id} not found")
    return job


def _update(job_id: str, **kwargs) -> None:
    with _guard:
        job = _jobs.get(job_id)
        if job is None:
            return
        for k, v in kwargs.items():
            setattr(job, k, v)


def append_metric(job_id: str, metric: dict) -> None:
    with _guard:
        job = _jobs.get(job_id)
        if job is None:
            return
        job.metrics.append(metric)


def make_progress_callback(job_id: str) -> Callable[[int, int, str], None]:
    def cb(current: int, total: int, message: str = "") -> None:
        percent = (current / total * 100) if total else 0.0
        _update(job_id, status="running", progress=JobProgress(current=current, total=total, percent=percent), message=message)
    return cb

def mark_running(job_id: str, message: str = "") -> None:
    _update(job_id, status="running", message=message)


def mark_completed(job_id: str, result: dict | None = None, message: str = "Completed") -> None:
    _update(job_id, status="completed", result=result, message=message)


def mark_failed(job_id: str, error: str) -> None:
    _update(job_id, status="failed", error=error, message="Failed")


def set_device_used(job_id: str, device: str) -> None:
    _update(job_id, device_used=device)


def set_batch_progress(job_id: str, batch_progress: dict) -> None:
    _update(job_id, batch_progress=batch_progress)
