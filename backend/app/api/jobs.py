from fastapi import APIRouter

from app.schemas.job import JobStatus
from app.services import job_service

router = APIRouter()


@router.get("/{job_id}", response_model=JobStatus)
async def get_job_status(job_id: str):
    return job_service.get_job(job_id)
