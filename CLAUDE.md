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
`useJobPolling`. Don't add a new long-running op without this pattern. The one documented
exception is SAM3 *annotation* progress, which is polled from the sidecar because that job runs
in the sidecar's process, not ours; the SAM3 *import* job follows the normal pattern.

**SAM3 (`/api/sam3/*`)** is an optional, separate program — its own repo, venv, CUDA GPU and
gated weights — reached over HTTP via `sam3_proxy_service` using `httpx`. Two hard rules:
`backend/requirements.txt` must gain **no** SAM3 dependency (no `transformers`, no `torch` pin),
and the app must keep working with the sidecar absent, since it also runs on CPU-only laptops. An
unreachable sidecar is a normal state and answers `503 sam3_unreachable`, which every `/sam3`
screen renders as one explanatory panel. Never spawn or install the sidecar from this app.

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
- SAM3 exports YOLO-**seg** polygon lines (`cls x1 y1 x2 y2 ...`), and nothing downstream can tell
  one from a box line: `parse_label_file` reads `tokens[1:5]` as `cx cy w h`, and
  `rewrite_label_class_ids` only rewrites `tokens[0]` and rejoins the rest verbatim. So a polygon
  copied straight into a dataset becomes a box built from its first two vertices — silently wrong,
  not an error. `utils/seg_to_box.py` recomputes the bbox over *every* vertex, and
  `sam3_import_service` runs it over a staging copy **before** handing anything to `merge_service`.
  Never merge a SAM3 export directly.
- YOLO's reported mAP can look deceptively high on tiny datasets even when the model's raw
  confidence never calibrates (it's rank-based, not confidence-based) — always sanity-check
  actual inference confidence, not just training metrics, before concluding a model "works."

## Testing discipline

There's no automated test suite. When verifying backend changes, use disposable `qa_`-prefixed
datasets (never the user's real datasets: check `datasets/` for current ones) and clean up
(`DELETE /api/datasets/{name}?confirm=true` + remove any test run folders under `runs/` and
`inference_outputs/`) when done.
