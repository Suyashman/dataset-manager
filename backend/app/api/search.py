from fastapi import APIRouter, Query

from app.services import search_service

router = APIRouter()


@router.get("")
async def search(q: str, scope: str = "all", dataset: str | None = None):
    return search_service.search(q, scope, dataset)
