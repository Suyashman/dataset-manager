import traceback

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.services.logging_service import log_event
from app.utils.errors import AppError

app = FastAPI(title="YOLO Dataset Manager API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    log_event(
        "error",
        f"Unhandled exception on {request.method} {request.url.path}: {exc}",
        level="ERROR",
        traceback=traceback.format_exc(),
    )
    return JSONResponse(
        status_code=500,
        content={"error": {"code": "internal_error", "message": "Something went wrong. Check logs for details.", "details": {}}},
    )


@app.get("/api/health")
async def health():
    return {"status": "ok"}


from app.api import datasets, images, stats, validation, search, settings as settings_api, logs, jobs, training, augmentation, inference, annotation  # noqa: E402

app.include_router(datasets.router, prefix="/api/datasets", tags=["datasets"])
app.include_router(images.router, prefix="/api/datasets", tags=["images"])
app.include_router(stats.router, prefix="/api/datasets", tags=["stats"])
app.include_router(validation.router, prefix="/api/datasets", tags=["validation"])
app.include_router(search.router, prefix="/api/search", tags=["search"])
app.include_router(settings_api.router, prefix="/api/settings", tags=["settings"])
app.include_router(logs.router, prefix="/api/logs", tags=["logs"])
app.include_router(jobs.router, prefix="/api/jobs", tags=["jobs"])
app.include_router(training.router, prefix="/api/training", tags=["training"])
app.include_router(augmentation.router, prefix="/api/augmentation", tags=["augmentation"])
app.include_router(inference.router, prefix="/api/inference", tags=["inference"])
app.include_router(annotation.router, prefix="/api/annotation", tags=["annotation"])
