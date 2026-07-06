from fastapi import APIRouter, BackgroundTasks

from app.schemas.dataset import CreateDatasetRequest, DatasetDetail, DatasetSummary, MergeDatasetRequest, MergeMultiRequest, ResplitRequest
from app.services import dataset_service, job_service, merge_service
from app.services.logging_service import log_event

router = APIRouter()


def _to_int_keyed(class_filter: dict[str, str] | None) -> dict[int, str] | None:
    return {int(k): v for k, v in class_filter.items()} if class_filter is not None else None


def _run_create_job(job_id: str, req: CreateDatasetRequest):
    job_service.mark_running(job_id, "Starting...")
    try:
        cb = job_service.make_progress_callback(job_id)
        result = dataset_service.create_dataset(
            req.source,
            req.new_name,
            req.prefix,
            req.splits_to_include,
            progress_cb=cb,
            class_filter=_to_int_keyed(req.class_filter),
        )
        job_service.mark_completed(job_id, result=result)
    except Exception as e:
        log_event("error", f"create_dataset job failed: {e}", level="ERROR")
        job_service.mark_failed(job_id, str(e))


def _run_merge_job(job_id: str, req: MergeDatasetRequest):
    job_service.mark_running(job_id, "Starting...")
    try:
        cb = job_service.make_progress_callback(job_id)
        result = merge_service.merge_dataset(
            req.source,
            req.destination,
            req.prefix,
            req.splits_to_include,
            progress_cb=cb,
            class_filter=_to_int_keyed(req.class_filter),
        )
        job_service.mark_completed(job_id, result=result)
    except Exception as e:
        log_event("error", f"merge_dataset job failed: {e}", level="ERROR")
        job_service.mark_failed(job_id, str(e))


def _run_merge_multi_job(job_id: str, req: MergeMultiRequest):
    job_service.mark_running(job_id, "Starting...")
    try:
        cb = job_service.make_progress_callback(job_id)
        sources = [
            {
                "source": s.source,
                "prefix": s.prefix,
                "class_filter": _to_int_keyed(s.class_filter),
            }
            for s in req.sources
        ]
        result = merge_service.merge_multiple(req.destination, sources, req.splits_to_include, progress_cb=cb)
        job_service.mark_completed(job_id, result=result)
    except Exception as e:
        log_event("error", f"merge_multi job failed: {e}", level="ERROR")
        job_service.mark_failed(job_id, str(e))


@router.post("/create")
async def create_dataset(req: CreateDatasetRequest, background_tasks: BackgroundTasks):
    job_id = job_service.create_job()
    background_tasks.add_task(_run_create_job, job_id, req)
    return {"job_id": job_id}


@router.post("/merge")
async def merge_dataset(req: MergeDatasetRequest, background_tasks: BackgroundTasks):
    job_id = job_service.create_job()
    background_tasks.add_task(_run_merge_job, job_id, req)
    return {"job_id": job_id}


@router.post("/merge-multi")
async def merge_multi(req: MergeMultiRequest, background_tasks: BackgroundTasks):
    if not req.sources:
        from app.utils.errors import AppError
        raise AppError("Pick at least one source dataset to merge")
    prefixes = [s.prefix for s in req.sources]
    if len(set(prefixes)) != len(prefixes):
        from app.utils.errors import AppError
        raise AppError("Each source needs a distinct prefix", details={"prefixes": prefixes})
    job_id = job_service.create_job()
    background_tasks.add_task(_run_merge_multi_job, job_id, req)
    return {"job_id": job_id}


@router.get("", response_model=list[DatasetSummary])
async def list_datasets():
    return dataset_service.list_datasets()


@router.get("/names", response_model=list[str])
async def list_dataset_names():
    """Lightweight name-only listing for dropdowns — no size/count computation, so it stays
    fast no matter how large the datasets get."""
    from app.services import yolo_service
    return yolo_service.list_dataset_names()


@router.get("/{name}", response_model=DatasetDetail)
async def get_dataset(name: str):
    return dataset_service.get_dataset_detail(name)


@router.post("/{name}/resplit")
async def resplit_dataset(name: str, req: ResplitRequest):
    return dataset_service.resplit_dataset(name, req.train, req.valid, req.test)


@router.delete("/{name}")
async def delete_dataset(name: str, confirm: bool = False):
    if not confirm:
        from app.utils.errors import AppError
        raise AppError("Pass confirm=true to delete this dataset", details={"name": name})
    dataset_service.delete_dataset(name)
    return {"deleted": name}
