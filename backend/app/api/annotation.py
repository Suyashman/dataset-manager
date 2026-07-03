from fastapi import APIRouter

from app.schemas.annotation import (
    AddClassRequest,
    AddClassResponse,
    CreateEmptyDatasetRequest,
    ImportFolderRequest,
    ImportFolderResponse,
    SaveBoxesRequest,
)
from app.services import annotation_service

router = APIRouter()


@router.post("/create-empty")
async def create_empty_dataset(req: CreateEmptyDatasetRequest):
    annotation_service.create_empty_dataset(req.name)
    return {"created": True, "name": req.name}


@router.post("/{dataset}/import-folder", response_model=ImportFolderResponse)
async def import_folder(dataset: str, req: ImportFolderRequest):
    return annotation_service.import_folder(dataset, req.folder_path, req.split, req.prefix)


@router.post("/{dataset}/classes", response_model=AddClassResponse)
async def add_class(dataset: str, req: AddClassRequest):
    class_id = annotation_service.add_class(dataset, req.name)
    return {"class_id": class_id, "name": req.name}


@router.put("/{dataset}/{split}/{filename}/boxes")
async def save_boxes(dataset: str, split: str, filename: str, req: SaveBoxesRequest):
    annotation_service.save_boxes(dataset, split, filename, [b.model_dump() for b in req.boxes])
    return {"saved": True}
