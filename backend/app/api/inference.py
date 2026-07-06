import uuid
from pathlib import Path

import cv2
from fastapi import APIRouter, BackgroundTasks, File, Form, UploadFile
from fastapi.responses import FileResponse

from app.config import INFERENCE_DIR, UPLOADS_DIR
from app.schemas.inference import (
    DetectionBox,
    ImageInferenceResult,
    MultiImageInferenceResponse,
    SpeedInfo,
    WebcamFrameResponse,
)
from app.services import inference_service, job_service
from app.services.logging_service import log_event
from app.utils.errors import AppError
from app.utils.file_ops import safe_path_join

router = APIRouter()

_MAX_BATCH_IMAGES = 30


def _save_annotated(annotated, batch_dir: Path, filename: str) -> str:
    out_name = f"{Path(filename).stem}.jpg"
    cv2.imwrite(str(batch_dir / out_name), annotated)
    return out_name


def _result_to_response(filename: str, batch_id: str, out_name: str, raw: dict) -> ImageInferenceResult:
    return ImageInferenceResult(
        filename=filename,
        boxes=[DetectionBox(**b) for b in raw["boxes"]],
        annotated_url=f"/api/inference/output/{batch_id}/{out_name}",
        speed=SpeedInfo(**raw["speed"]),
    )


@router.get("/output/{batch_id}/{filename}")
async def get_output_file(batch_id: str, filename: str):
    path = safe_path_join(INFERENCE_DIR, batch_id, filename)
    if not path.exists():
        raise AppError("Output file not found")
    return FileResponse(path)


@router.post("/image", response_model=ImageInferenceResult)
async def infer_image(
    image: UploadFile = File(...),
    run_name: str = Form(...),
    weights: str = Form("best"),
    device: str = Form("cpu"),
    conf: float = Form(0.25, ge=0.0, le=1.0),
    iou: float = Form(0.45, ge=0.0, le=1.0),
):
    model = inference_service.get_model(run_name, weights, device)
    image_bytes = await image.read()
    raw = inference_service.run_image_inference(model, image_bytes, device, conf, iou)

    batch_id, batch_dir = inference_service.new_batch_dir()
    out_name = _save_annotated(raw["annotated"], batch_dir, image.filename or "image.jpg")
    return _result_to_response(image.filename or "image.jpg", batch_id, out_name, raw)


@router.post("/images", response_model=MultiImageInferenceResponse)
async def infer_images(
    images: list[UploadFile] = File(...),
    run_name: str = Form(...),
    weights: str = Form("best"),
    device: str = Form("cpu"),
    conf: float = Form(0.25, ge=0.0, le=1.0),
    iou: float = Form(0.45, ge=0.0, le=1.0),
):
    if len(images) > _MAX_BATCH_IMAGES:
        raise AppError(f"Pick at most {_MAX_BATCH_IMAGES} images at a time", details={"count": len(images)})

    model = inference_service.get_model(run_name, weights, device)
    batch_id, batch_dir = inference_service.new_batch_dir()

    results = []
    for image in images:
        image_bytes = await image.read()
        raw = inference_service.run_image_inference(model, image_bytes, device, conf, iou)
        out_name = _save_annotated(raw["annotated"], batch_dir, image.filename or f"{uuid.uuid4().hex}.jpg")
        results.append(_result_to_response(image.filename or out_name, batch_id, out_name, raw))

    return MultiImageInferenceResponse(results=results)


@router.post("/webcam-frame", response_model=WebcamFrameResponse)
async def infer_webcam_frame(
    frame: UploadFile = File(...),
    run_name: str = Form(...),
    weights: str = Form("best"),
    device: str = Form("cpu"),
    conf: float = Form(0.25, ge=0.0, le=1.0),
    iou: float = Form(0.45, ge=0.0, le=1.0),
):
    model = inference_service.get_model(run_name, weights, device)
    frame_bytes = await frame.read()
    raw = inference_service.run_webcam_frame(model, frame_bytes, device, conf, iou)
    return WebcamFrameResponse(boxes=[DetectionBox(**b) for b in raw["boxes"]], speed=SpeedInfo(**raw["speed"]))


def _run_video_job(job_id: str, video_path: Path, run_name: str, weights: str, device: str, conf: float, iou: float, frame_stride: int):
    job_service.mark_running(job_id, "Loading model...")
    try:
        model = inference_service.get_model(run_name, weights, device)
        cb = job_service.make_progress_callback(job_id)
        result = inference_service.run_video_inference(job_id, model, video_path, device, conf, iou, frame_stride, progress_cb=cb)
        result["output_url"] = f"/api/inference/output/{result['batch_id']}/{result['output_filename']}"
        job_service.mark_completed(job_id, result=result, message="Video inference complete")
    except Exception as e:
        log_event("error", f"video inference job failed: {e}", level="ERROR")
        job_service.mark_failed(job_id, str(e))
    finally:
        video_path.unlink(missing_ok=True)


@router.post("/video")
async def infer_video(
    background_tasks: BackgroundTasks,
    video: UploadFile = File(...),
    run_name: str = Form(...),
    weights: str = Form("best"),
    device: str = Form("cpu"),
    conf: float = Form(0.25, ge=0.0, le=1.0),
    iou: float = Form(0.45, ge=0.0, le=1.0),
    frame_stride: int = Form(3, ge=1),
):
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    video_path = UPLOADS_DIR / f"{uuid.uuid4().hex}_{video.filename or 'video.mp4'}"
    with open(video_path, "wb") as f:
        f.write(await video.read())

    job_id = job_service.create_job()
    background_tasks.add_task(_run_video_job, job_id, video_path, run_name, weights, device, conf, iou, max(1, frame_stride))
    return {"job_id": job_id}
