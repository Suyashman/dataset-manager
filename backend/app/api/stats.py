from fastapi import APIRouter

from app.schemas.stats import DatasetStats
from app.services import stats_service

router = APIRouter()


@router.get("/{name}/stats", response_model=DatasetStats)
async def get_stats(name: str):
    return stats_service.compute_stats(name)
