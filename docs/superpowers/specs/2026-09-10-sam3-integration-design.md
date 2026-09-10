# SAM3 Auto-Labeler Integration

**Date:** 2026-09-10
**Status:** Approved, ready for implementation

## Goal

Expose the SAM3 auto-labeler as a first-class section of the Dataset Manager UI, so a user can
run AI-assisted pre-labeling, review the results, and fold accepted labels into an existing
Dataset Manager dataset — without ever leaving the app.

## Hard constraint

**Dataset Manager must keep working, unchanged, on CPU-only laptops with no SAM3 installed.**

The user runs this app on machines that cannot host SAM3 (no CUDA, and downloading the gated
1.7 GB `facebook/sam3` weights is not acceptable there). Therefore:

- `backend/requirements.txt` gains **no** new packages. No `transformers`, no `torch` pin, no
  `opencv-python`.
- No SAM3 model code is imported by the Dataset Manager backend, at any point, on any path.
- The SAM3 feature degrades to a single explanatory screen when its sidecar is unreachable.
  Nothing else in the app changes behavior or breaks.

## Architecture

SAM3 stays exactly what it is today: a standalone FastAPI app in `SAM3/` with its own venv,
started manually (`python sam3_server.py`) on a GPU machine. Dataset Manager never spawns,
supervises, or installs it.

Integration happens at two seams:

```
  Browser (Dataset Manager frontend)
      │
      │  /api/sam3/*            ← same-origin, no CORS needed
      ▼
  Dataset Manager backend  ──httpx──►  SAM3 sidecar (separate venv/process/GPU box)
      │                                     │
      │  /api/sam3/import                   │  writes YOLO-seg dataset to disk
      ▼                                     ▼
  merge_service  ◄──── polygon→box conversion ──── SAM3 export dir
```

### Seam 1: HTTP proxy (live interaction)

`backend/app/api/sam3.py` + `backend/app/services/sam3_proxy_service.py`

A pass-through proxy mounted at `/api/sam3/*`, forwarding to the sidecar's **existing,
unmodified** endpoints:

| Proxied route | Method | Sidecar endpoint |
|---|---|---|
| `/api/sam3/env` | GET | `/api/env` |
| `/api/sam3/browse` | GET | `/api/browse` |
| `/api/sam3/runs` | GET | `/api/runs` |
| `/api/sam3/run` | POST | `/api/run` |
| `/api/sam3/cancel` | POST | `/api/cancel` |
| `/api/sam3/status` | GET | `/api/status` |
| `/api/sam3/review` | GET | `/api/review` |
| `/api/sam3/instances` | GET | `/api/instances` |
| `/api/sam3/image` | GET | `/api/image` (binary passthrough) |
| `/api/sam3/decision` | POST | `/api/decision` |
| `/api/sam3/refine` | POST | `/api/refine` |
| `/api/sam3/adopt` | POST | `/api/adopt` |
| `/api/sam3/export` | POST | `/api/export` |

Implementation rules:

- Uses `httpx`, which is **already** in `requirements.txt`. No new dependency.
- Connect timeout of 2s; read timeout of 180s (`/api/refine` runs model inference and
  `/api/export` shells out to `sam3_export.py`, both of which are slow but bounded).
- On `httpx.ConnectError` / `ConnectTimeout`, raise `Sam3UnreachableError(AppError)` with
  `code = "sam3_unreachable"` and `status_code = 503`. This reuses the app's existing error
  plumbing — `main.py`'s handler renders it as `{"error": {"code", "message", "details"}}` and
  `client.ts` turns it into an `ApiError` the UI can branch on by code. Never surface a raw
  500 — an absent sidecar is an expected state, not a crash.
- Non-connection errors from the sidecar are relayed with their original status code and body,
  so the sidecar's own `HTTPException` messages stay visible to the user.
- `/api/sam3/image` streams bytes through with the upstream `content-type` intact.

### Seam 2: Import job (file handoff)

`backend/app/services/sam3_import_service.py`

The sidecar's `/api/export` writes a YOLO **segmentation** dataset (polygon label lines) to a
path on disk. This service converts it to Dataset Manager's box format and merges it in.

**Polygon → box conversion.** A YOLO-seg line is `cls x1 y1 x2 y2 ... xn yn`. The bounding box
is computed over **every** coordinate pair:

```
cx = (min(xs) + max(xs)) / 2
cy = (min(ys) + max(ys)) / 2
w  =  max(xs) - min(xs)
h  =  max(ys) - min(ys)
```

Written as `cls cx cy w h` with `%.6f` formatting, matching the rest of the app.

This recomputation is mandatory, not cosmetic: `label_utils.parse_label_file` reads
`tokens[1:5]` as `cx cy w h`, so a polygon line passed through unconverted would be silently
misread as a box built from the polygon's first two vertices. Likewise
`merge_service.rewrite_label_class_ids` only rewrites `tokens[0]` and rejoins the rest verbatim,
so it would happily copy polygon lines into a box-format dataset. Conversion must therefore
happen **before** the merge, not during it.

**Flow.** `POST /api/sam3/import` with
`{export_dir, destination, prefix, splits_to_include, class_filter?}`:

1. Validate `destination` and `prefix` through `validate_safe_name()`; validate splits against
   `SPLITS`.
2. Copy the export into a staging directory, rewriting every label file from polygon to box
   format. Staging keeps the user's original SAM3 export untouched.
3. Call the existing `merge_service.merge_dataset()` with the staging directory as source. All
   existing behavior — per-prefix numbering, class unification by name, `data.yaml` rewrite,
   metadata history, cached-summary refresh — comes along for free.
4. Delete the staging directory.

Runs as a `BackgroundTasks` + `job_service` job, per the convention in `CLAUDE.md`. Progress is
reported through the same `progress_cb` mechanism `merge_dataset` already accepts.

**Class-name matching.** `merge_class_mappings` unifies classes by exact, case-sensitive name.
A SAM3 class named `goggle` merging into a dataset that has `goggles` produces a *new* class,
not a match. The import screen must therefore show, before the user commits, which source class
names map onto existing destination ids and which will be created — and offer the rename that
`class_filter` already supports.

### Sidecar URL configuration

The sidecar's base URL is a setting (`metadata/settings.json`, via the existing Settings page),
defaulting to `http://127.0.0.1:8800`. This lets a CPU laptop point at a GPU box on the LAN, or
leave it alone and simply never use the feature.

## Frontend

New nav item **"SAM3 Auto-Label"**, alongside Annotate / Merge / Augment / Train / Search. Routes
under `/sam3`, styled with the app's existing shadcn + Tailwind primitives.

**Connectivity gate.** Every `/sam3` screen first resolves `/api/sam3/env`. On a 503 it renders a
single explanatory panel — *"SAM3 is not running. Start `sam3_server.py` on a machine with a
CUDA GPU, then set its URL in Settings."* — with a link to Settings. No spinners, no retry
storms, no errors bleeding into the rest of the app.

**Screens:**

1. **Run** — directory browser (`/api/sam3/browse`), class + prompt editor (produces the
   sidecar's `classes.json` shape: `[{name, prompts[]}]`), optional `--sample` count, start.
   Surfaces GPU/VRAM facts from `/api/sam3/env`, because free VRAM is what predicts an OOM.
2. **Runs** — run list with done/total, live progress, rate and ETA from `/api/sam3/status`;
   cancel action.
3. **Review** — the core workspace:
   - Queue from `/api/sam3/review`, ordered most-uncertain-first.
   - A **new** canvas component. `AnnotationCanvas` is box-only (`EditableBox`) and cannot render
     arbitrary polygons, so this is a separate component rather than an extension of it.
   - Per-instance accept / reject / reclassify via `/api/sam3/decision`, with keyboard shortcuts
     matching the original tool: `A` accept, `R` reject, `U` clear, `1`–`9` set class, arrows to
     move.
   - Confidence histogram and per-folder breakdown from `/api/sam3/status`.
   - Accept/reject threshold sliders — client-side only, since the gate is a filter over stored
     predictions and never re-runs the model.
   - Exemplar refinement: drag a box, "Find similar" (`/api/sam3/refine`), then adopt results
     (`/api/sam3/adopt`). Negative exemplars are presented as a *hint*, never as a delete —
     the SAM3 README documents that they do not reliably suppress the instance they cover.
4. **Export & Import** — fires `/api/sam3/export`, shows the returned `MANIFEST.txt`, then offers
   "Import into dataset" (destination / prefix / splits picker, mirroring `MergeDataset.tsx`)
   which starts the import job and polls it with `useJobPolling`.

Box colors follow the app's existing convention: per-class, keyed by class id, with an optional
user override — never baked into individual instances.

## Deliberate deviations

1. **Run progress does not use `job_service`.** `CLAUDE.md` requires new long-running operations
   to use `BackgroundTasks` + `job_service`, but an annotation run's job genuinely lives in the
   sidecar's process, which owns its own subprocess, log, and progress derivation. Mirroring that
   state into our job store would create two sources of truth that can disagree. The **import**
   job, which does run in our process, follows the convention exactly.

2. **No "measure gate" button in v1.** `sam3_validate.py` is CLI-only — `sam3_server.py` exposes
   no `/api/validate` endpoint. v1 therefore *reads and honors* `gate.json` when present (the
   sidecar's `/api/status` already returns it as `measured`, and `sam3_export.py` already prefers
   it over a guessed threshold), but cannot trigger a measurement run from the UI. Adding that
   requires a new endpoint in the SAM3 repo and is out of scope here.

## Out of scope

- Segmentation support anywhere else in Dataset Manager. Datasets, training, stats, and the
  annotation canvas remain box-only.
- Installing, downloading, supervising, or health-checking SAM3 from Dataset Manager.
- Any modification to the files in `SAM3/`. They are consumed exactly as they exist.

## Testing

No automated suite exists in this repo, so verification follows `CLAUDE.md`'s discipline:

- **Polygon→box conversion** gets a runnable self-check (`assert`-based, no framework), covering:
  a triangle, a polygon touching image edges, coordinate clamping to `[0,1]`, `%.6f` formatting,
  and an already-box-format line passing through unchanged.
- **Proxy unreachable path** is verified with the sidecar stopped: every `/sam3` screen must show
  the explanatory panel, and every other page in the app must behave normally.
- **Import** is verified end-to-end into a disposable `qa_`-prefixed dataset, then cleaned up
  (`DELETE /api/datasets/{name}?confirm=true`). Never against the user's real datasets.
- Backend has no `--reload`, so the uvicorn process must be restarted after each backend change.
