from fastapi import APIRouter

from app.schemas.settings import SettingsModel
from app.services import settings_service

router = APIRouter()


@router.get("", response_model=SettingsModel)
async def get_settings():
    return settings_service.load_settings()


@router.put("", response_model=SettingsModel)
async def put_settings(settings: SettingsModel):
    settings_service.save_settings(settings)
    return settings
