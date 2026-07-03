from fastapi import APIRouter, BackgroundTasks

from app.schemas.training import DeviceInfo, TrainingRun, TrainRequest
from app.services import job_service, training_service
from app.services.logging_service import log_event

router = APIRouter()


def _run_train_job(job_id: str, req: TrainRequest):
    try:
        training_service.run_training(job_id, req)
    except Exception as e:
        log_event("error", f"train job failed: {e}", level="ERROR")
        job_service.mark_failed(job_id, str(e))


@router.get("/device", response_model=DeviceInfo)
async def device_info():
    return training_service.get_device_info()


@router.get("/runs", response_model=list[TrainingRun])
async def list_runs():
    return training_service.list_runs()


@router.post("/start")
async def start_training(req: TrainRequest, background_tasks: BackgroundTasks):
    job_id = job_service.create_job()
    background_tasks.add_task(_run_train_job, job_id, req)
    return {"job_id": job_id}


@router.post("/{job_id}/stop")
async def stop_training(job_id: str):
    from app.utils.errors import AppError

    if not training_service.request_stop(job_id):
        raise AppError("No active training run for this job", details={"job_id": job_id})
    return {"stopping": True}
