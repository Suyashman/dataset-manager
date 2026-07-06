# YOLO Dataset Manager

A local-only tool for managing YOLO object detection datasets: import/merge Roboflow exports,
hand-annotate raw images into a YOLO dataset from scratch, augment datasets, train YOLO models
(CPU/GPU), and run inference (image/batch/video/webcam) — all in the browser, all on disk, no
cloud dependency.

## Architecture

**Backend** (`backend/app`, FastAPI): `api/` (routes) → `services/` (business logic) →
`utils/` (file ops, atomic JSON/YAML I/O, numbering, path-safety). `schemas/` holds Pydantic
request/response models with `Field()` boundary validation.

**Frontend** (`frontend/src`, React + Vite + Tailwind v4 + shadcn): `pages/` (one per route),
`components/` (shared + `ui/` shadcn primitives), `api/` (typed fetch wrappers), `lib/`
(pure helpers like YOLO box math), `hooks/`.

**Key design decision:** an annotation project *is* the dataset. Creating one via Annotate
(`create-empty` / `create-from-reference`) writes directly into `datasets/{name}/` in real YOLO
layout (`train|valid|test/images,labels` + `data.yaml`) from the moment it's created — there is
no separate "export" step. Training points straight at that `data.yaml`.

**Long-running jobs** (create/merge/train/video-inference) use FastAPI `BackgroundTasks` +
`job_service` (in-memory job store, `_MAX_JOBS = 200` eviction). Frontend polls via
`useJobPolling`. Don't add a new long-running op without this pattern.

## Conventions

- Dataset names and import prefixes must pass `validate_safe_name()` (utils/file_ops.py) —
  blocks path traversal (`..`, `/`, `\`, leading non-alphanumeric). Never bypass this at a new
  choke point that touches the filesystem with user input.
- `split` params are always validated against the `SPLITS` tuple in `config.py`.
- Imported images are renamed `{PREFIX}{zero-padded number}.ext`, counters tracked per-prefix in
  `metadata/{dataset}.json` (see `metadata_service.py`). Reusing a prefix continues its counter.
- React Query: single-resource lookups (`getDataset`, `getLabel`) use `retry: false` so a 404
  settles into an error state immediately instead of a stuck `fetchStatus: "paused"`.
  `networkMode: "always"` is set globally.
- Box colors in the annotation UI are per-class, keyed by class id, with an optional user
  override (`classColors` map) — never baked into individual boxes.

## Running it

One-click: `start.bat` (opens both servers + browser). Manual: two terminals —
```
backend:  cd backend && venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
frontend: cd frontend && npm run dev
```
**Backend has no `--reload`** — after editing backend code you must kill and restart the
uvicorn process (same command) for changes to take effect; the frontend has Vite HMR and
picks up changes automatically.

## Known gotchas

- On Windows, the venv's `python.exe` re-execs the base interpreter (`__PYVENV_LAUNCHER__`
  stub), so `Get-CimInstance ... CommandLine` shows the *global* Python path even when it's
  correctly running with venv site-packages. Not a bug — don't "fix" it.
- Video inference output must be written with `cv2.VideoWriter_fourcc(*"avc1")` (H.264), not
  `mp4v` — Chrome's `<video>` can't decode `mp4v`/MPEG-4 Part 2, so the job completes fine but
  the browser shows a blank player. Falls back to `mp4v` only if `avc1` fails to open.
- YOLO's reported mAP can look deceptively high on tiny datasets even when the model's raw
  confidence never calibrates (it's rank-based, not confidence-based) — always sanity-check
  actual inference confidence, not just training metrics, before concluding a model "works."

## Testing discipline

There's no automated test suite. When verifying backend changes, use disposable `qa_`-prefixed
datasets (never the user's real datasets: check `datasets/` for current ones) and clean up
(`DELETE /api/datasets/{name}?confirm=true` + remove any test run folders under `runs/` and
`inference_outputs/`) when done.
