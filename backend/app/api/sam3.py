"""Routes for the SAM3 auto-labeler.

Everything here is a pass-through to the sidecar, which owns the model, the GPU and the run
directory. This app adds no SAM3 dependency of its own -- see sam3_proxy_service for why.
"""
from fastapi import APIRouter, Response

from app.schemas.sam3 import (
    Sam3AdoptRequest,
    Sam3CancelRequest,
    Sam3DecisionRequest,
    Sam3ExportRequest,
    Sam3RefineRequest,
    Sam3RunRequest,
)
from app.services import sam3_proxy_service

router = APIRouter()


def _relay(res) -> Response:
    """Hand the sidecar's response back verbatim -- status, body and content type."""
    return Response(
        content=res.content,
        status_code=res.status_code,
        media_type=res.headers.get("content-type", "application/json"),
    )


@router.get("/env")
async def env():
    return _relay(await sam3_proxy_service.forward("GET", "/api/env"))


@router.get("/browse")
async def browse(path: str):
    return _relay(await sam3_proxy_service.forward("GET", "/api/browse", params={"path": path}))


@router.get("/runs")
async def runs():
    return _relay(await sam3_proxy_service.forward("GET", "/api/runs"))


@router.post("/run")
async def start_run(req: Sam3RunRequest):
    return _relay(await sam3_proxy_service.forward("POST", "/api/run", json_body=req.model_dump(exclude_none=True)))


@router.post("/cancel")
async def cancel(req: Sam3CancelRequest):
    # The sidecar tracks exactly one active job and its /api/cancel takes no body, so `req` is
    # accepted (the UI sends the run name it thinks it is cancelling) but not forwarded.
    return _relay(await sam3_proxy_service.forward("POST", "/api/cancel"))


@router.get("/status")
async def status(run: str, accept: str = "0.6", reject: str = "0.4"):
    return _relay(await sam3_proxy_service.forward(
        "GET", "/api/status", params={"run": run, "accept": accept, "reject": reject}))


@router.get("/review")
async def review(run: str, accept: str = "0.6", reject: str = "0.4", limit: int = 400):
    return _relay(await sam3_proxy_service.forward(
        "GET", "/api/review", params={"run": run, "accept": accept, "reject": reject, "limit": limit}))


@router.get("/instances")
async def instances(run: str, file: str):
    return _relay(await sam3_proxy_service.forward("GET", "/api/instances", params={"run": run, "file": file}))


@router.get("/image")
async def image(run: str, file: str):
    return _relay(await sam3_proxy_service.forward("GET", "/api/image", params={"run": run, "file": file}))


@router.post("/decision")
async def decision(req: Sam3DecisionRequest):
    return _relay(await sam3_proxy_service.forward("POST", "/api/decision", json_body=req.model_dump()))


@router.post("/refine")
async def refine(req: Sam3RefineRequest):
    return _relay(await sam3_proxy_service.forward("POST", "/api/refine", json_body=req.model_dump(exclude_none=True)))


@router.post("/adopt")
async def adopt(req: Sam3AdoptRequest):
    return _relay(await sam3_proxy_service.forward("POST", "/api/adopt", json_body=req.model_dump()))


@router.post("/export")
async def export(req: Sam3ExportRequest):
    return _relay(await sam3_proxy_service.forward("POST", "/api/export", json_body=req.model_dump()))
