from fastapi import APIRouter, Query

from app.services import logging_service

router = APIRouter()


@router.get("")
async def list_logs():
    return {"dates": logging_service.list_log_dates()}


@router.get("/{date}")
async def get_log(date: str, lines: int = Query(200, le=2000)):
    return {"date": date, "entries": logging_service.read_log(date, lines)}
