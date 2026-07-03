from fastapi import APIRouter

from app.schemas.validation import ValidationReport
from app.services import validation_service

router = APIRouter()


@router.get("/{name}/validate", response_model=ValidationReport)
async def validate_dataset(name: str):
    return validation_service.run_validation(name)
