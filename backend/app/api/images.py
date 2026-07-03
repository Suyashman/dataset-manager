from pathlib import Path

from fastapi import APIRouter, Query
from fastapi.responses import FileResponse

from app.config import SPLITS
from app.schemas.image import ImageInfo, ImageListResponse, LabelBox, LabelResponse
from app.services import yolo_service
from app.utils.errors import AppError
from app.utils.file_ops import iter_image_files, safe_path_join
from app.utils.image_utils import get_image_resolution
from app.utils.label_utils import parse_label_file

router = APIRouter()


@router.get("/{name}/images", response_model=ImageListResponse)
async def list_images(name: str, split: str | None = Query(None), page: int = 1, page_size: int = 60):
    path = yolo_service.dataset_path(name)
    splits = [split] if split else list(SPLITS)

    # Cheap pass: just gather (split, path) pairs without touching image/label contents,
    # so this stays fast even for datasets with thousands of images.
    refs: list[tuple[str, Path]] = []
    for sp in splits:
        if sp not in SPLITS:
            raise AppError(f"Invalid split '{sp}'", details={"valid_splits": list(SPLITS)})
        refs.extend((sp, img) for img in iter_image_files(path / sp / "images"))

    total = len(refs)
    start = (page - 1) * page_size
    page_refs = refs[start:start + page_size]

    # Expensive pass (PIL open + label parse) only runs over the current page.
    items = []
    for sp, img in page_refs:
        label_path = path / sp / "labels" / (img.stem + ".txt")
        boxes = parse_label_file(label_path) if label_path.exists() else []
        items.append(ImageInfo(
            filename=img.name,
            split=sp,
            resolution=get_image_resolution(img),
            has_label=label_path.exists(),
            box_count=len(boxes),
        ))

    return ImageListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/{name}/images/{split}/{filename}")
async def get_image_file(name: str, split: str, filename: str):
    if split not in SPLITS:
        raise AppError(f"Invalid split '{split}'")
    path = yolo_service.dataset_path(name)
    img_path = safe_path_join(path, split, "images", filename)
    if not img_path.exists():
        raise AppError("Image not found", details={"file": filename})
    return FileResponse(img_path)


@router.get("/{name}/labels/{split}/{filename}", response_model=LabelResponse)
async def get_label(name: str, split: str, filename: str):
    if split not in SPLITS:
        raise AppError(f"Invalid split '{split}'")
    path = yolo_service.dataset_path(name)
    stem = filename.rsplit(".", 1)[0]
    label_path = safe_path_join(path, split, "labels", f"{stem}.txt")
    classes = yolo_service.get_classes(name)
    raw_text = label_path.read_text(encoding="utf-8", errors="ignore") if label_path.exists() else ""
    boxes = []
    for box in parse_label_file(label_path):
        boxes.append(LabelBox(
            class_id=box["class_id"],
            class_name=classes.get(box["class_id"], f"class_{box['class_id']}"),
            x_center=box["x_center"],
            y_center=box["y_center"],
            width=box["width"],
            height=box["height"],
        ))
    return LabelResponse(boxes=boxes, raw_text=raw_text)
