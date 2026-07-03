from fastapi import APIRouter, BackgroundTasks

from app.schemas.augmentation import AugmentRequest
from app.services import augmentation_service, job_service
from app.services.logging_service import log_event
from app.utils.errors import AppError

router = APIRouter()


def _run_augment_job(job_id: str, req: AugmentRequest):
    job_service.mark_running(job_id, "Cloning dataset...")
    try:
        cb = job_service.make_progress_callback(job_id)
        result = augmentation_service.augment_dataset(req.source, req.destination, req.techniques, progress_cb=cb)
        job_service.mark_completed(job_id, result=result, message="Augmentation complete")
    except Exception as e:
        log_event("error", f"augment_dataset job failed: {e}", level="ERROR")
        job_service.mark_failed(job_id, str(e))


@router.post("/start")
async def start_augment(req: AugmentRequest, background_tasks: BackgroundTasks):
    if not req.techniques:
        raise AppError("Pick at least one augmentation technique")
    job_id = job_service.create_job()
    background_tasks.add_task(_run_augment_job, job_id, req)
    return {"job_id": job_id}
