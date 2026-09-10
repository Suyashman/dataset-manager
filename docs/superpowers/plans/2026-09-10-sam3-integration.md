# SAM3 Auto-Labeler Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "SAM3 Auto-Label" section to Dataset Manager that drives the standalone SAM3 sidecar over HTTP and folds its reviewed output into a dataset as box labels.

**Architecture:** Dataset Manager's backend gains a thin `httpx` pass-through proxy at `/api/sam3/*` pointing at a user-configured sidecar URL, plus an import job that converts SAM3's polygon labels to box format and hands them to the existing `merge_service`. The frontend gains a `/sam3` section that gates every screen on sidecar reachability. No SAM3 model code, weights, or dependencies ever enter this app.

**Tech Stack:** FastAPI, Pydantic, `httpx` (already a dependency), React + Vite, React Query, Tailwind v4, shadcn, `react-router-dom`, `lucide-react`, `sonner` (toasts).

## Global Constraints

- **`backend/requirements.txt` gains no new packages.** `httpx` is already listed; use only it and the stdlib.
- **No `transformers`, `torch`, `opencv`, or SAM3 module import** on any Dataset Manager code path.
- **Never spawn, install, or supervise the sidecar.** It is started by hand by the user.
- **An unreachable sidecar is an expected state, not an error.** It must never produce a raw 500 or break any non-`/sam3` page.
- Dataset names and prefixes must pass `validate_safe_name()` (`app/utils/file_ops.py`).
- `split` values must be validated against the `SPLITS` tuple in `app/config.py`.
- Label coordinates are written `%.6f`, clamped to `[0,1]`.
- Backend has **no `--reload`**: after any backend change, kill and restart uvicorn
  (`cd backend && venv\Scripts\python.exe -m uvicorn app.main:app --port 8000`).
- Backend errors are raised as `AppError` subclasses; `main.py`'s handler renders them as
  `{"error": {"code", "message", "details"}}`, which `frontend/src/api/client.ts` turns into `ApiError`.
- QA uses disposable `qa_`-prefixed datasets only, cleaned up afterward. Never touch real datasets.

---

### Task 1: Commit the two in-flight annotation UI changes

These changes predate this feature and are already in the working tree. They ship first so the
SAM3 work starts from a clean tree.

**Files:**
- Modify: none (already modified on disk)
  - `frontend/src/components/AnnotationCanvas.tsx` (box hit-test tolerance)
  - `frontend/src/pages/AnnotationWorkspace.tsx` (class grid layout + letter shortcuts)

**Interfaces:**
- Consumes: nothing.
- Produces: a clean working tree.

- [ ] **Step 1: Confirm what is staged**

Run: `git diff --stat`
Expected: exactly two files — `AnnotationCanvas.tsx` (+12/-1 or similar) and `AnnotationWorkspace.tsx`.

- [ ] **Step 2: Verify the frontend still compiles**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit the canvas change alone**

```bash
git add frontend/src/components/AnnotationCanvas.tsx
git commit -m "$(cat <<'EOF'
Give box hit-testing a few px of slack

Eyewear and glove boxes are only a handful of screen pixels wide, so a
pixel-perfect rect made them near-impossible to select.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Commit the workspace change alone**

```bash
git add frontend/src/pages/AnnotationWorkspace.tsx
git commit -m "$(cat <<'EOF'
Move annotation classes to a grid and extend shortcuts past nine

Digits 1-9 ran out on the 8-class PPE sets once more classes were added,
so classes past the ninth take letters. The grid keeps them all visible
without a tall sidebar.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify the tree is clean**

Run: `git status --short`
Expected: empty output.

---

### Task 2: Polygon → box conversion

The one piece of genuinely non-trivial logic in this feature. It gets its own self-check because
a silent error here corrupts a dataset.

**Files:**
- Create: `backend/app/utils/seg_to_box.py`
- Create: `backend/scripts/test_seg_to_box.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `seg_line_to_box_line(line: str) -> str | None` — one YOLO-seg label line to one YOLO
    detection line; `None` when the line is unparseable or degenerate.
  - `convert_label_file(src: Path, dst: Path) -> tuple[int, int]` — returns
    `(lines_written, lines_skipped)`. Writes an empty file when the source is empty, never a
    missing file.

- [ ] **Step 1: Write the failing self-check**

Create `backend/scripts/test_seg_to_box.py`:

```python
#!/usr/bin/env python
"""Self-check for polygon -> box conversion. No pytest, just asserts.

    venv\\Scripts\\python.exe backend\\scripts\\test_seg_to_box.py

This is the logic that silently corrupts a dataset if it breaks: a polygon line copied
through unconverted is read by parse_label_file as a box built from the polygon's first
two vertices.
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.utils.seg_to_box import convert_label_file, seg_line_to_box_line

# --- a triangle's bounding box comes from every vertex, not the first two ----
line = seg_line_to_box_line("3 0.2 0.2 0.8 0.3 0.5 0.9")
assert line == "3 0.500000 0.550000 0.600000 0.700000", line
print("ok  triangle -> bbox over all vertices")

# --- an already-4-value detection line passes through, reformatted -----------
assert seg_line_to_box_line("0 0.5 0.5 0.25 0.25") == "0 0.500000 0.500000 0.250000 0.250000"
print("ok  detection line passes through")

# --- coordinates are clamped to [0,1] ---------------------------------------
out = seg_line_to_box_line("1 -0.1 -0.1 1.4 0.5 0.5 1.2")
vals = [float(v) for v in out.split()[1:]]
assert all(0.0 <= v <= 1.0 for v in vals), out
print("ok  coordinates clamped to [0,1]")

# --- class id survives, including a float-formatted one ---------------------
assert seg_line_to_box_line("7 0.1 0.1 0.2 0.2 0.3 0.3").startswith("7 ")
assert seg_line_to_box_line("7.0 0.1 0.1 0.2 0.2 0.3 0.3").startswith("7 ")
print("ok  class id preserved")

# --- garbage produces None rather than a corrupt line -----------------------
for bad in ("", "   ", "0", "0 0.1 0.1", "x 0.1 0.1 0.2 0.2 0.3 0.3",
            "0 0.1 0.1 0.2 0.2 0.3"):
    assert seg_line_to_box_line(bad) is None, bad
print("ok  unparseable lines rejected")

# --- a zero-area polygon is degenerate, not a box ---------------------------
assert seg_line_to_box_line("0 0.5 0.5 0.5 0.5 0.5 0.5") is None
print("ok  zero-area polygon rejected")

# --- file conversion, including the empty-file rule -------------------------
with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    src = td / "a.txt"
    src.write_text("0 0.2 0.2 0.8 0.3 0.5 0.9\ngarbage\n1 0.1 0.1 0.4 0.1 0.4 0.4\n")
    dst = td / "out" / "a.txt"
    written, skipped = convert_label_file(src, dst)
    assert (written, skipped) == (2, 1), (written, skipped)
    lines = dst.read_text().splitlines()
    assert len(lines) == 2 and all(len(l.split()) == 5 for l in lines), lines

    # An image with no instances must get an EMPTY .txt, never a missing one:
    # missing makes Ultralytics skip the image, empty teaches it a true negative.
    empty_src = td / "b.txt"
    empty_src.write_text("")
    empty_dst = td / "out" / "b.txt"
    assert convert_label_file(empty_src, empty_dst) == (0, 0)
    assert empty_dst.exists() and empty_dst.read_text() == ""
print("ok  file conversion writes boxes and preserves empty labels")

print("\nall checks passed")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && venv\Scripts\python.exe scripts\test_seg_to_box.py`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.utils.seg_to_box'`.

- [ ] **Step 3: Write the implementation**

Create `backend/app/utils/seg_to_box.py`:

```python
from pathlib import Path


def _clamp(v: float) -> float:
    return min(max(v, 0.0), 1.0)


def seg_line_to_box_line(line: str) -> str | None:
    """One YOLO-seg polygon line -> one YOLO detection line, or None if unusable.

    The bounding box is recomputed over EVERY vertex. This is not cosmetic: nothing
    downstream can tell a polygon line from a box line, and parse_label_file reads
    tokens[1:5] as cx/cy/w/h — so an unconverted polygon silently becomes a box built
    from its first two vertices.

    A 4-value payload is already a detection box and passes through reformatted, so this
    is safe to run over a mixed directory.
    """
    parts = line.split()
    if len(parts) < 5:
        return None
    try:
        cls = int(float(parts[0]))
        vals = [float(v) for v in parts[1:]]
    except ValueError:
        return None

    if len(vals) == 4:
        cx, cy, w, h = vals
    else:
        # A polygon needs at least 3 vertices, hence 6 values, in x/y pairs.
        if len(vals) < 6 or len(vals) % 2:
            return None
        xs, ys = vals[0::2], vals[1::2]
        x1, x2, y1, y2 = min(xs), max(xs), min(ys), max(ys)
        cx, cy, w, h = (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1

    w, h = _clamp(w), _clamp(h)
    if w <= 0 or h <= 0:
        return None
    return f"{cls} {_clamp(cx):.6f} {_clamp(cy):.6f} {w:.6f} {h:.6f}"


def convert_label_file(src: Path, dst: Path) -> tuple[int, int]:
    """Convert one label file. Returns (lines_written, lines_skipped).

    Always writes dst, even when nothing survives: an empty .txt teaches Ultralytics that
    the image is a true negative, while a MISSING .txt makes it skip the image entirely.
    Those are different datasets.
    """
    out, skipped = [], 0
    if src.exists():
        for raw in src.read_text(encoding="utf-8").splitlines():
            if not raw.strip():
                continue
            converted = seg_line_to_box_line(raw)
            if converted is None:
                skipped += 1
            else:
                out.append(converted)

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text("\n".join(out) + ("\n" if out else ""), encoding="utf-8")
    return len(out), skipped
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && venv\Scripts\python.exe scripts\test_seg_to_box.py`
Expected: every `ok` line prints, ending with `all checks passed`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/utils/seg_to_box.py backend/scripts/test_seg_to_box.py
git commit -m "$(cat <<'EOF'
Add polygon-to-box label conversion

SAM3 exports YOLO-seg polygons but every dataset here is box-detection.
Nothing downstream can tell the two apart -- parse_label_file would read a
polygon's first two vertices as a box -- so the bounding box is recomputed
over every vertex before any polygon label reaches a dataset.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Sidecar URL setting

**Files:**
- Modify: `backend/app/schemas/settings.py`
- Modify: `frontend/src/types/settings.ts`
- Modify: `frontend/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `SettingsModel.sam3_sidecar_url: str` (default `"http://127.0.0.1:8800"`), readable via
  `settings_service.load_settings().sam3_sidecar_url`.

- [ ] **Step 1: Add the backend field**

In `backend/app/schemas/settings.py`, add to `SettingsModel` (after `theme`):

```python
    # Base URL of the standalone SAM3 auto-labeler. It runs in its own venv on a machine with a
    # CUDA GPU and is never started or installed by this app, so this can point at localhost or
    # another box on the LAN. An unreachable URL is a normal state, not a misconfiguration.
    sam3_sidecar_url: str = "http://127.0.0.1:8800"
```

- [ ] **Step 2: Verify the field round-trips**

Restart uvicorn, then run:
`curl -s http://127.0.0.1:8000/api/settings`
Expected: JSON containing `"sam3_sidecar_url": "http://127.0.0.1:8800"`.

- [ ] **Step 3: Mirror the type on the frontend**

In `frontend/src/types/settings.ts`, add the field to `SettingsModel` after `theme`:

```ts
  sam3_sidecar_url: string;
```

- [ ] **Step 4: Add the Settings page control**

In `frontend/src/pages/Settings.tsx`, after the "Default prefixes" block (around line 65), add:

```tsx
          <div className="space-y-2">
            <Label>SAM3 sidecar URL</Label>
            <Input
              value={form.sam3_sidecar_url}
              onChange={(e) => setForm({ ...form, sam3_sidecar_url: e.target.value })}
              placeholder="http://127.0.0.1:8800"
            />
            <p className="text-xs text-muted-foreground">
              Where the SAM3 auto-labeler is running. It needs a CUDA GPU, so leave this alone on
              CPU-only machines — the rest of the app works without it.
            </p>
          </div>
```

- [ ] **Step 5: Verify end to end**

Run: `cd frontend && npx tsc --noEmit` (expect no errors), then in the browser open Settings, change
the URL, save, reload the page, and confirm the new value persisted.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/settings.py frontend/src/types/settings.ts frontend/src/pages/Settings.tsx
git commit -m "$(cat <<'EOF'
Add a configurable SAM3 sidecar URL setting

Lets a CPU-only laptop point at a GPU box on the LAN, or ignore the
feature entirely, without any of it being wired into startup.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Backend proxy to the sidecar

**Files:**
- Create: `backend/app/services/sam3_proxy_service.py`
- Create: `backend/app/api/sam3.py`
- Modify: `backend/app/main.py:47-60` (import and mount the router)
- Modify: `backend/app/utils/errors.py` (add `Sam3UnreachableError`)

**Interfaces:**
- Consumes: `settings_service.load_settings().sam3_sidecar_url` (Task 3);
  `AppError` from `app/utils/errors.py`.
- Produces:
  - `Sam3UnreachableError(AppError)` with `code = "sam3_unreachable"`, `status_code = 503`.
  - `async forward(method: str, path: str, *, params: dict | None = None, json_body: dict | None = None) -> httpx.Response`
  - Routes under `/api/sam3/`: `env`, `browse`, `runs`, `run`, `cancel`, `status`, `review`,
    `instances`, `image`, `decision`, `refine`, `adopt`, `export`.

- [ ] **Step 1: Add the error type**

Append to `backend/app/utils/errors.py`:

```python
class Sam3UnreachableError(AppError):
    code = "sam3_unreachable"
    status_code = 503
```

- [ ] **Step 2: Write the proxy service**

Create `backend/app/services/sam3_proxy_service.py`:

```python
"""Pass-through proxy to the standalone SAM3 auto-labeler.

Deliberately thin. The sidecar owns all SAM3 state -- the run directory, the loaded model, the
annotation subprocess -- and this app owns none of it. Proxying rather than reimplementing keeps
transformers/torch out of this venv entirely, which is what lets Dataset Manager keep running on
CPU-only laptops.

Requests go through the app's own origin so the sidecar needs no CORS changes, and so an
unreachable sidecar surfaces as one predictable error shape instead of an opaque browser failure.
"""
import httpx

from app.services import settings_service
from app.utils.errors import AppError, Sam3UnreachableError

# Long enough for the slow-but-bounded endpoints (/api/refine runs model inference,
# /api/export shells out to sam3_export.py), short on connect because "not running" is a
# normal answer and the UI should hear it immediately rather than hang.
_CONNECT_TIMEOUT = 2.0
_READ_TIMEOUT = 180.0


def sidecar_url() -> str:
    return settings_service.load_settings().sam3_sidecar_url.rstrip("/")


async def forward(
    method: str,
    path: str,
    *,
    params: dict | None = None,
    json_body: dict | None = None,
) -> httpx.Response:
    """Forward one request to the sidecar and hand back its raw response.

    Connection failures become Sam3UnreachableError. Everything else -- including the sidecar's
    own 4xx/5xx -- is returned as-is so its error messages reach the user unmodified.
    """
    base = sidecar_url()
    timeout = httpx.Timeout(_READ_TIMEOUT, connect=_CONNECT_TIMEOUT)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            return await client.request(method, f"{base}{path}", params=params, json=json_body)
    except (httpx.ConnectError, httpx.ConnectTimeout):
        raise Sam3UnreachableError(
            "SAM3 is not running. Start sam3_server.py on a machine with a CUDA GPU, "
            "then check the sidecar URL in Settings.",
            details={"sidecar_url": base},
        )
    except httpx.HTTPError as e:
        raise AppError(f"SAM3 request failed: {type(e).__name__}: {e}", details={"sidecar_url": base})
```

- [ ] **Step 3: Write the router**

Create `backend/app/api/sam3.py`:

```python
"""Routes for the SAM3 auto-labeler.

Everything here except /import is a pass-through to the sidecar. /import is the one piece of real
work this app does: convert the sidecar's polygon output to boxes and merge it into a dataset.
"""
from fastapi import APIRouter, BackgroundTasks, Response

from app.schemas.sam3 import (
    Sam3AdoptRequest,
    Sam3CancelRequest,
    Sam3DecisionRequest,
    Sam3ExportRequest,
    Sam3ImportRequest,
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
```

- [ ] **Step 4: Write the request schemas**

Create `backend/app/schemas/sam3.py`. These mirror the sidecar's own Pydantic models
(`RunReq`, `DecisionReq`, `RefineReq`, `AdoptReq`, `ExportReq` in `SAM3/sam3_server.py`):

```python
from pydantic import BaseModel, Field


class Sam3ClassSpec(BaseModel):
    name: str
    prompts: list[str] = []


class Sam3RunRequest(BaseModel):
    images: str
    classes: list[Sam3ClassSpec]
    name: str
    sample: int | None = Field(None, ge=1)


class Sam3CancelRequest(BaseModel):
    run: str | None = None


class Sam3DecisionRequest(BaseModel):
    run: str
    file: str
    idx: int
    # "accept" | "reject" | {"cls": n} | None to clear
    decision: str | dict | None = None


class Sam3RefineRequest(BaseModel):
    run: str
    file: str
    text: str | None = None
    boxes: list[list[float]] = []   # [[x1,y1,x2,y2], ...] normalized 0..1
    labels: list[int] = []          # 1 positive, 0 negative
    threshold: float = Field(0.25, ge=0.0, le=1.0)


class Sam3AdoptRequest(BaseModel):
    run: str
    file: str
    cls: int
    instances: list[dict]


class Sam3ExportRequest(BaseModel):
    run: str
    out: str
    accept: str = "0.6"
    reject: str = "0.4"
    val: float = Field(0.2, ge=0.0, le=1.0)
    group_by_dir: bool = False
    copy_images: bool = False


class Sam3ImportRequest(BaseModel):
    """Fold an already-exported SAM3 dataset into a Dataset Manager dataset."""
    export_dir: str
    destination: str
    prefix: str
    splits_to_include: list[str] = ["train", "valid", "test"]
    class_filter: dict[str, str] | None = None
```

- [ ] **Step 5: Mount the router**

In `backend/app/main.py`, add `sam3` to the import on line 47 and append:

```python
app.include_router(sam3.router, prefix="/api/sam3", tags=["sam3"])
```

- [ ] **Step 6: Verify the unreachable path**

With **no** sidecar running, restart uvicorn and run:
`curl -s -o - -w "\n%{http_code}\n" http://127.0.0.1:8000/api/sam3/env`
Expected: HTTP `503` and a body of
`{"error":{"code":"sam3_unreachable","message":"SAM3 is not running...","details":{"sidecar_url":"http://127.0.0.1:8800"}}}`
Then confirm `curl -s http://127.0.0.1:8000/api/datasets/names` still works normally — an absent
sidecar must not affect anything else.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/sam3_proxy_service.py backend/app/api/sam3.py backend/app/schemas/sam3.py backend/app/main.py backend/app/utils/errors.py
git commit -m "$(cat <<'EOF'
Proxy the SAM3 sidecar instead of embedding it

The sidecar owns the model, the GPU and the run directory; this app owns
none of it and gains no dependencies. A sidecar that isn't running answers
503 sam3_unreachable, which is a normal state on the CPU-only laptops this
app also has to run on.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Import job — staged conversion, then merge

**Files:**
- Create: `backend/app/services/sam3_import_service.py`
- Modify: `backend/app/api/sam3.py` (add the `/import` route)
- Modify: `backend/app/config.py` (add `SAM3_STAGING_DIR`)

**Interfaces:**
- Consumes: `convert_label_file` (Task 2); `Sam3ImportRequest` (Task 4);
  `merge_service.merge_dataset`; `job_service`; `validate_safe_name`; `SPLITS`.
- Produces:
  - `import_sam3_export(export_dir: str, destination: str, prefix: str, splits_to_include: list[str], progress_cb=None, class_filter: dict[int, str] | None = None) -> dict`
    — the return value is `merge_dataset`'s result dict plus `"labels_converted"` and
    `"lines_skipped"` counts.
  - `describe_export(export_dir: str) -> dict` with keys `classes: dict[int, str]`,
    `split_counts: dict[str, int]`, `total_images: int` — used by the UI to preview a merge
    before committing to it.

- [ ] **Step 1: Add the staging directory constant**

In `backend/app/config.py`, next to the other directory constants, add:

```python
SAM3_STAGING_DIR = ROOT_DIR / "uploads" / "_sam3_staging"
```

Do **not** add it to the auto-`mkdir` loop — it is created and destroyed per import.

- [ ] **Step 2: Write the import service**

Create `backend/app/services/sam3_import_service.py`:

```python
"""Fold a SAM3 export into a Dataset Manager dataset.

SAM3 writes YOLO-seg polygons; every dataset here is box-detection. Conversion has to happen
BEFORE the merge, not during it: merge_service.rewrite_label_class_ids only rewrites tokens[0]
and rejoins the rest verbatim, so it would copy polygon lines straight into a box dataset.

So this stages a converted copy first, then hands that to the existing merge, which keeps all
of the numbering, class-unification, metadata and cache-refresh behaviour for free. Images are
hardlinked into staging where the filesystem allows it, so a multi-GB export is not copied twice.
"""
import os
import shutil
import time
from pathlib import Path

from app.config import SAM3_STAGING_DIR, SPLITS
from app.services import merge_service
from app.utils.errors import AppError
from app.utils.file_ops import iter_image_files, validate_safe_name
from app.utils.seg_to_box import convert_label_file
from app.utils.yaml_io import load_data_yaml, save_data_yaml


def _resolve_export(export_dir: str) -> Path:
    path = Path(export_dir).expanduser()
    if not path.is_dir():
        raise AppError(f"No such SAM3 export directory: {path}")
    if not (path / "data.yaml").exists():
        raise AppError(
            f"{path} has no data.yaml, so it is not a SAM3 export. Run Export first.",
            details={"export_dir": str(path)},
        )
    return path


def describe_export(export_dir: str) -> dict:
    """Summarize an export so the UI can show what a merge would bring in."""
    path = _resolve_export(export_dir)
    counts = {
        split: sum(1 for _ in iter_image_files(path / split / "images"))
        for split in SPLITS
    }
    return {
        "export_dir": str(path),
        "classes": load_data_yaml(path / "data.yaml")["classes"],
        "split_counts": counts,
        "total_images": sum(counts.values()),
    }


def _link_or_copy(src: Path, dst: Path) -> None:
    """Hardlink when possible, copy otherwise. Staging exists only to be merged out of, so a
    hardlink is enough and avoids duplicating image bytes for a large export."""
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def _stage(export_path: Path, splits_to_include: list[str]) -> tuple[Path, int, int]:
    """Build a box-format copy of the export. Returns (staging_dir, converted, skipped)."""
    staging = SAM3_STAGING_DIR / f"{export_path.name}_{int(time.time())}"
    converted = skipped = 0
    for split in splits_to_include:
        images_dir = export_path / split / "images"
        labels_dir = export_path / split / "labels"
        out_images = staging / split / "images"
        out_labels = staging / split / "labels"
        out_images.mkdir(parents=True, exist_ok=True)
        out_labels.mkdir(parents=True, exist_ok=True)
        for img in iter_image_files(images_dir):
            _link_or_copy(img, out_images / img.name)
            n_written, n_skipped = convert_label_file(
                labels_dir / f"{img.stem}.txt", out_labels / f"{img.stem}.txt"
            )
            converted += n_written
            skipped += n_skipped

    # The class list is authoritative from the export's own data.yaml, never from what was
    # detected -- a class that found nothing still has to hold its index.
    save_data_yaml(staging / "data.yaml", load_data_yaml(export_path / "data.yaml")["classes"])
    return staging, converted, skipped


def import_sam3_export(
    export_dir: str,
    destination: str,
    prefix: str,
    splits_to_include: list[str],
    progress_cb=None,
    class_filter: dict[int, str] | None = None,
) -> dict:
    invalid = [s for s in splits_to_include if s not in SPLITS]
    if invalid:
        raise AppError(f"Invalid split(s): {invalid}", details={"valid_splits": list(SPLITS)})
    validate_safe_name(destination, "dataset name")
    validate_safe_name(prefix, "prefix")
    export_path = _resolve_export(export_dir)

    if progress_cb:
        progress_cb(0, 1, "Converting polygon labels to boxes...")
    staging, converted, skipped = _stage(export_path, splits_to_include)
    try:
        result = merge_service.merge_dataset(
            staging.name,
            destination,
            prefix,
            splits_to_include,
            progress_cb=progress_cb,
            class_filter=class_filter,
            source_root=staging.parent,
        )
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    return {**result, "labels_converted": converted, "lines_skipped": skipped,
            "export_dir": str(export_path)}
```

- [ ] **Step 3: Teach `merge_dataset` to accept an out-of-tree source**

`merge_service.merge_dataset` resolves its source through
`yolo_service.validate_source_dataset(source)`, which looks under `DATASETS_DIR`. Staging lives
under `uploads/`, so add an optional `source_root` parameter.

In `backend/app/services/merge_service.py`, change the signature (line ~67) to add
`source_root: Path | None = None` as the last parameter, and replace the source resolution:

```python
    if source_root is None:
        src_path = yolo_service.validate_source_dataset(source)
    else:
        # Import flows (e.g. a staged SAM3 export) merge from outside DATASETS_DIR. The path is
        # built by this app, never from user input, so it does not go through validate_safe_name.
        src_path = (source_root / source).resolve()
        if not (src_path / "data.yaml").exists():
            raise AppError(f"No data.yaml under {src_path}")
```

Document the parameter in the docstring. Leave every existing caller untouched — the default
preserves current behavior exactly.

- [ ] **Step 4: Add the import and preview routes**

Append to `backend/app/api/sam3.py`:

```python
def _run_import_job(job_id: str, req: Sam3ImportRequest):
    job_service.mark_running(job_id, "Starting...")
    try:
        cb = job_service.make_progress_callback(job_id)
        class_filter = {int(k): v for k, v in req.class_filter.items()} if req.class_filter else None
        result = sam3_import_service.import_sam3_export(
            req.export_dir,
            req.destination,
            req.prefix,
            req.splits_to_include,
            progress_cb=cb,
            class_filter=class_filter,
        )
        job_service.mark_completed(job_id, result=result)
    except Exception as e:
        log_event("error", f"sam3 import job failed: {e}", level="ERROR")
        job_service.mark_failed(job_id, str(e))


@router.get("/export-preview")
async def export_preview(export_dir: str):
    """What a merge would bring in — classes and per-split counts — before committing to it."""
    return sam3_import_service.describe_export(export_dir)


@router.post("/import")
async def import_export(req: Sam3ImportRequest, background_tasks: BackgroundTasks):
    job_id = job_service.create_job()
    background_tasks.add_task(_run_import_job, job_id, req)
    return {"job_id": job_id}
```

Add to that file's imports: `from app.services import job_service, sam3_import_service, sam3_proxy_service`
and `from app.services.logging_service import log_event`.

- [ ] **Step 5: Verify against a hand-built fake export**

The sidecar isn't needed for this — the import path only reads files. Build a fake export and
merge it into a disposable dataset:

```bash
cd backend
venv\Scripts\python.exe -c "from pathlib import Path; import json; p=Path('../uploads/qa_fake_export'); [ (p/s/'images').mkdir(parents=True, exist_ok=True) or (p/s/'labels').mkdir(parents=True, exist_ok=True) for s in ('train','valid') ]; from PIL import Image; Image.new('RGB',(64,48),'gray').save(p/'train/images/a.jpg'); (p/'train/labels/a.txt').write_text('0 0.2 0.2 0.8 0.3 0.5 0.9\n'); Image.new('RGB',(64,48),'gray').save(p/'valid/images/b.jpg'); (p/'valid/labels/b.txt').write_text(''); (p/'data.yaml').write_text('train: train/images\nval: valid/images\nnc: 1\nnames: [person]\n'); print('built', p.resolve())"
```

Then:
```bash
curl -s "http://127.0.0.1:8000/api/sam3/export-preview?export_dir=../uploads/qa_fake_export"
curl -s -X POST http://127.0.0.1:8000/api/sam3/import -H "Content-Type: application/json" -d "{\"export_dir\":\"../uploads/qa_fake_export\",\"destination\":\"qa_sam3_import\",\"prefix\":\"QA\",\"splits_to_include\":[\"train\",\"valid\"]}"
```

Expected: preview reports `{"person"}` and `{"train": 1, "valid": 1}`; the import job completes;
`datasets/qa_sam3_import/train/labels/QA000001.txt` contains exactly
`0 0.500000 0.550000 0.600000 0.700000`; the valid label file exists and is empty; and
`uploads/_sam3_staging` no longer exists.

- [ ] **Step 6: Clean up the QA artifacts**

```bash
curl -s -X DELETE "http://127.0.0.1:8000/api/datasets/qa_sam3_import?confirm=true"
rm -rf uploads/qa_fake_export
```

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/sam3_import_service.py backend/app/api/sam3.py backend/app/config.py backend/app/services/merge_service.py
git commit -m "$(cat <<'EOF'
Import a SAM3 export into a dataset as box labels

Staging a converted copy first means the existing merge does the rest --
numbering, class unification by name, metadata history, cache refresh --
with no duplication. Images are hardlinked into staging so a multi-GB
export isn't copied twice.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Frontend plumbing — types, API wrappers, nav, connectivity gate

**Files:**
- Create: `frontend/src/types/sam3.ts`
- Create: `frontend/src/api/sam3.ts`
- Create: `frontend/src/components/Sam3Unreachable.tsx`
- Create: `frontend/src/pages/Sam3Studio.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/layout/AppShell.tsx`

**Interfaces:**
- Consumes: `/api/sam3/*` (Tasks 4, 5); `api` + `ApiError` from `@/api/client`.
- Produces:
  - Types: `Sam3Env`, `Sam3BrowseResult`, `Sam3RunSummary`, `Sam3Status`, `Sam3ClassStat`,
    `Sam3ReviewItem`, `Sam3Instance`, `Sam3InstancesResult`, `Sam3RefineResult`,
    `Sam3ExportResult`, `Sam3ExportPreview`.
  - API fns: `getSam3Env`, `browseSam3`, `listSam3Runs`, `startSam3Run`, `cancelSam3Run`,
    `getSam3Status`, `getSam3Review`, `getSam3Instances`, `sam3ImageUrl`, `postSam3Decision`,
    `refineSam3`, `adoptSam3`, `exportSam3`, `previewSam3Export`, `importSam3Export`.
  - `<Sam3Unreachable detail={string} />` — the shared not-running panel.
  - `useSam3Env()` — React Query hook returning `{ env, unreachable, detail, isLoading }`.

- [ ] **Step 1: Write the types**

Create `frontend/src/types/sam3.ts`, mirroring the sidecar's response shapes exactly as they appear
in `SAM3/sam3_server.py`:

```ts
export interface Sam3Env {
  model_loaded: boolean;
  torch?: string;
  transformers?: string;
  gpu?: string;
  vram_free_gb?: number;
  vram_total_gb?: number;
  error?: string;
}

export interface Sam3BrowseDir {
  name: string;
  path: string;
  images: number;
}

export interface Sam3BrowseResult {
  path: string;
  parent: string;
  dirs: Sam3BrowseDir[];
  images_here: number;
}

export interface Sam3RunSummary {
  name: string;
  total: number;
  done: number;
  classes: string[];
  images: string;
  mtime: number;
}

export interface Sam3ClassStat {
  id: number;
  name: string;
  prompts: string[];
  accepted: number;
  review: number;
  dropped: number;
  rejected: number;
  total: number;
}

export interface Sam3Status {
  run: string;
  running: boolean;
  done: number;
  total: number;
  rate: number | null;
  eta: number | null;
  classes: Sam3ClassStat[];
  buckets: { accepted: number; review: number; dropped: number; rejected: number };
  instances: number;
  split_parts: number;
  empty_images: number;
  hist: number[];
  hist_lo: number;
  hist_hi: number;
  accept: number[];
  reject: number[];
  measured: { accept: Record<string, number>; source?: string } | null;
  decisions: number;
  folders: { name: string; images: number; instances: number; accepted: number }[];
  images_dir: string;
  log: string;
}

export interface Sam3ReviewItem {
  file: string;
  w: number;
  h: number;
  n_review: number;
  uncertainty: number;
}

export interface Sam3Instance {
  cls: number;
  prompt: string;
  score: number;
  poly: number[];
  box: [number, number, number, number];
  parts: number;
}

export interface Sam3InstancesResult {
  file: string;
  w: number;
  h: number;
  instances: Sam3Instance[];
  decisions: Record<string, string | { cls: number }>;
  classes: { id: number; name: string }[];
}

export interface Sam3RefineResult {
  instances: { score: number; poly: number[]; parts: number; box: [number, number, number, number] }[];
}

export interface Sam3ExportResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  manifest: string;
}

export interface Sam3ExportPreview {
  export_dir: string;
  // JSON object keys are always strings, matching DatasetDetail.classes in types/dataset.ts.
  classes: Record<string, string>;
  split_counts: Record<string, number>;
  total_images: number;
}
```

- [ ] **Step 2: Write the API wrappers**

Create `frontend/src/api/sam3.ts`:

```ts
import { api } from "@/api/client";
import type {
  Sam3BrowseResult, Sam3Env, Sam3ExportPreview, Sam3ExportResult, Sam3InstancesResult,
  Sam3RefineResult, Sam3RunSummary, Sam3Status, Sam3ReviewItem,
} from "@/types/sam3";

const q = encodeURIComponent;

export const getSam3Env = () => api.get<Sam3Env>("/sam3/env");
export const browseSam3 = (path: string) => api.get<Sam3BrowseResult>(`/sam3/browse?path=${q(path)}`);
export const listSam3Runs = () => api.get<Sam3RunSummary[]>("/sam3/runs");

export const startSam3Run = (req: {
  images: string;
  classes: { name: string; prompts: string[] }[];
  name: string;
  sample?: number;
}) => api.post<{ started: string; cmd: string }>("/sam3/run", req);

export const cancelSam3Run = (run: string) => api.post<{ cancelled: boolean }>("/sam3/cancel", { run });

export const getSam3Status = (run: string, accept: string, reject: string) =>
  api.get<Sam3Status>(`/sam3/status?run=${q(run)}&accept=${q(accept)}&reject=${q(reject)}`);

export const getSam3Review = (run: string, accept: string, reject: string, limit = 400) =>
  api.get<{ total: number; items: Sam3ReviewItem[] }>(
    `/sam3/review?run=${q(run)}&accept=${q(accept)}&reject=${q(reject)}&limit=${limit}`);

export const getSam3Instances = (run: string, file: string) =>
  api.get<Sam3InstancesResult>(`/sam3/instances?run=${q(run)}&file=${q(file)}`);

// An <img src>, not a fetch — it streams through the proxy with its content type intact.
export const sam3ImageUrl = (run: string, file: string) =>
  `/api/sam3/image?run=${q(run)}&file=${q(file)}`;

export const postSam3Decision = (req: {
  run: string; file: string; idx: number; decision: string | { cls: number } | null;
}) => api.post<{ ok: boolean; decisions: number }>("/sam3/decision", req);

export const refineSam3 = (req: {
  run: string; file: string; text?: string; boxes: number[][]; labels: number[]; threshold?: number;
}) => api.post<Sam3RefineResult>("/sam3/refine", req);

export const adoptSam3 = (req: { run: string; file: string; cls: number; instances: unknown[] }) =>
  api.post<{ ok: boolean; n: number }>("/sam3/adopt", req);

export const exportSam3 = (req: {
  run: string; out: string; accept: string; reject: string; val: number;
  group_by_dir: boolean; copy_images: boolean;
}) => api.post<Sam3ExportResult>("/sam3/export", req);

export const previewSam3Export = (exportDir: string) =>
  api.get<Sam3ExportPreview>(`/sam3/export-preview?export_dir=${q(exportDir)}`);

export const importSam3Export = (req: {
  export_dir: string; destination: string; prefix: string;
  splits_to_include: string[]; class_filter?: Record<string, string> | null;
}) => api.post<{ job_id: string }>("/sam3/import", req);
```

- [ ] **Step 3: Write the unreachable panel and env hook**

Create `frontend/src/components/Sam3Unreachable.tsx`:

```tsx
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PlugZap } from "lucide-react";
import { ApiError } from "@/api/client";
import { getSam3Env } from "@/api/sam3";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Resolves sidecar reachability once and shares it across every SAM3 screen.
 *
 * `retry: false` matters here for the same reason it does on single-resource lookups: a
 * missing sidecar is a settled answer, not a transient failure worth retrying. */
export function useSam3Env() {
  const query = useQuery({
    queryKey: ["sam3-env"],
    queryFn: getSam3Env,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const err = query.error instanceof ApiError ? query.error : null;
  return {
    env: query.data ?? null,
    isLoading: query.isLoading,
    unreachable: err?.code === "sam3_unreachable",
    detail: err?.message ?? "",
  };
}

export function Sam3Unreachable({ detail }: { detail?: string }) {
  return (
    <Card className="max-w-xl">
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center gap-2 font-medium">
          <PlugZap className="h-4 w-4 text-muted-foreground" />
          SAM3 is not running
        </div>
        <p className="text-sm text-muted-foreground">
          {detail ||
            "Start sam3_server.py on a machine with a CUDA GPU, then point this app at it."}
        </p>
        <p className="text-xs text-muted-foreground">
          SAM3 needs a CUDA GPU and the gated <code>facebook/sam3</code> weights, so it is not
          expected to run on CPU-only machines. Everything else in Dataset Manager works without it.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings">Set the sidecar URL</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Create the section shell**

Create `frontend/src/pages/Sam3Studio.tsx`. Tasks 7-11 each fill in one tab, so the shell owns the
selected run and the gate values that Review and Export both read:

```tsx
import { useState } from "react";
import { Sam3Unreachable, useSam3Env } from "@/components/Sam3Unreachable";
import { Button } from "@/components/ui/button";

const TABS = ["Run", "Runs", "Review", "Export"] as const;
type Tab = (typeof TABS)[number];

export function Sam3Studio() {
  const { env, isLoading, unreachable, detail } = useSam3Env();
  const [tab, setTab] = useState<Tab>("Run");
  // Lifted here because Review sets the gate and Export needs the same values.
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [accept, setAccept] = useState("0.6");
  const [reject, setReject] = useState("0.4");

  if (isLoading) return null;
  if (unreachable) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold mb-1">SAM3 Auto-Label</h1>
        <p className="text-muted-foreground mb-6">
          AI-assisted pre-labeling: name the concepts you want, review what SAM3 found, then import
          the accepted labels into a dataset.
        </p>
        <Sam3Unreachable detail={detail} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold mb-1">SAM3 Auto-Label</h1>
      <p className="text-muted-foreground mb-2">
        AI-assisted pre-labeling: name the concepts you want, review what SAM3 found, then import
        the accepted labels into a dataset. These are model predictions — nothing here should reach
        a training run unreviewed.
      </p>
      {env?.gpu && (
        <p className="text-xs text-muted-foreground mb-6">
          {env.gpu}
          {env.vram_free_gb != null && ` · ${env.vram_free_gb} GB VRAM free of ${env.vram_total_gb} GB`}
          {env.torch && ` · torch ${env.torch}`}
        </p>
      )}

      <div className="flex gap-1 mb-4 border-b border-border">
        {TABS.map((t) => (
          <Button
            key={t}
            variant="ghost"
            size="sm"
            onClick={() => setTab(t)}
            className={tab === t ? "border-b-2 border-foreground rounded-none" : "rounded-none"}
          >
            {t}
          </Button>
        ))}
      </div>

      {/* Tasks 7-11 mount their panels here, passing selectedRun / accept / reject. */}
      {tab === "Run" && <div className="text-sm text-muted-foreground">Run panel — Task 7.</div>}
      {tab === "Runs" && <div className="text-sm text-muted-foreground">Runs panel — Task 8.</div>}
      {tab === "Review" && <div className="text-sm text-muted-foreground">Review panel — Task 9.</div>}
      {tab === "Export" && <div className="text-sm text-muted-foreground">Export panel — Task 11.</div>}
    </div>
  );
}
```

Each later task replaces its placeholder `<div>` with the real panel and removes the corresponding
comment line. `setSelectedRun`, `setAccept` and `setReject` are consumed by Tasks 8-11.

- [ ] **Step 5: Wire the route and nav item**

In `frontend/src/App.tsx`, import `Sam3Studio` and add inside the `AppShell` route:

```tsx
        <Route path="/sam3" element={<Sam3Studio />} />
```

In `frontend/src/components/layout/AppShell.tsx`, add `Bot` to the `lucide-react` import and add to
the `Datasets` group's `items`, directly after the Annotate entry:

```tsx
      { to: "/sam3", label: "SAM3 Auto-Label", icon: Bot },
```

- [ ] **Step 6: Verify the gate**

Run `cd frontend && npx tsc --noEmit` (expect no errors). With the backend up and **no** sidecar,
open `/sam3`: expect only the "SAM3 is not running" panel, no console errors, and every other page
still working normally.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/types/sam3.ts frontend/src/api/sam3.ts frontend/src/components/Sam3Unreachable.tsx frontend/src/pages/Sam3Studio.tsx frontend/src/App.tsx frontend/src/components/layout/AppShell.tsx
git commit -m "$(cat <<'EOF'
Add the SAM3 section shell and its not-running gate

Every SAM3 screen resolves reachability first and degrades to one
explanatory panel, so the feature is inert rather than broken on the
CPU-only machines this app also runs on.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Run screen — browse, prompts, start

**Files:**
- Create: `frontend/src/components/sam3/Sam3RunPanel.tsx`
- Modify: `frontend/src/pages/Sam3Studio.tsx` (mount the panel in the `Run` tab)

**Interfaces:**
- Consumes: `browseSam3`, `startSam3Run`, `useSam3Env` (Task 6).
- Produces: `<Sam3RunPanel onStarted={(runName: string) => void} />`.

- [ ] **Step 1: Build the directory browser**

`useQuery` on `["sam3-browse", path]` calling `browseSam3(path)`, seeded from
`env.images_root ?? "/"`, falling back to the value the sidecar echoes back in `path`. Render:
an "up" button using `parent`, a list of `dirs` with their recursive `images` counts, and the
current directory's own `images_here`. Selecting a directory sets it as the run's `images` value.

- [ ] **Step 2: Build the class + prompt editor**

Rows of `{ name, prompts }`, each with a name `Input`, a comma-separated prompts `Input`, and a
remove button; plus "Add class". Empty prompts default to the class name (the sidecar's
`load_classes` already does this, so send `prompts: []` and let it decide).

Show this warning above the editor verbatim, because it is the single biggest failure mode:

> Prompt wording and image resolution dominate results. `goggles` found 0 instances at 640×360 and
> 251 on higher-resolution frames with the identical prompt. Run a sample of 30 first and read the
> per-class counts before committing a whole folder.

- [ ] **Step 3: Build the start controls**

A run-name `Input` (default `run_<YYYYMMDD_HHMMSS>`), an optional sample-count `Input`, and a
Start button. Validate before sending: images dir non-empty, run name non-empty, at least one
class with a non-empty name. On success call `onStarted(name)` and `toast.success`. On `ApiError`
with status 409 (`a job is already running`), surface the sidecar's message with `toast.error`.

- [ ] **Step 4: Show the GPU facts**

Above the form, render `env.gpu`, `env.vram_free_gb` / `env.vram_total_gb`, and `env.torch`.
Include this note next to free VRAM: SAM3 needs ~2.3 GB, and free VRAM — not total — is what
predicts an out-of-memory failure.

- [ ] **Step 5: Verify**

Run `cd frontend && npx tsc --noEmit`. With no sidecar, `/sam3` still shows only the unreachable
panel. If a GPU box is available, point Settings at it, browse to a folder, and start a 5-image
sample run; confirm the sidecar's `job.log` shows the run starting.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/sam3/Sam3RunPanel.tsx frontend/src/pages/Sam3Studio.tsx
git commit -m "$(cat <<'EOF'
Add the SAM3 run panel: browse, prompts, start

Puts the sample-first warning in front of the user, since prompt wording
and source resolution decide whether a class finds anything at all.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Runs screen — list, live progress, cancel

**Files:**
- Create: `frontend/src/components/sam3/Sam3RunsPanel.tsx`
- Modify: `frontend/src/pages/Sam3Studio.tsx` (mount in the `Runs` tab)

**Interfaces:**
- Consumes: `listSam3Runs`, `getSam3Status`, `cancelSam3Run` (Task 6).
- Produces: `<Sam3RunsPanel selectedRun={string | null} onSelectRun={(run: string) => void} />`.

- [ ] **Step 1: Build the runs table**

`useQuery` on `["sam3-runs"]`. Columns: name, images dir, classes, `done`/`total` with a progress
bar, and last-modified from `mtime`. Clicking a row calls `onSelectRun`.

- [ ] **Step 2: Add live progress for the selected run**

`useQuery` on `["sam3-status", run, accept, reject]` with `refetchInterval: (query) =>
query.state.data?.running ? 1000 : false`, so polling stops on its own when the run finishes.
Render `done`/`total`, `rate` (img/s), `eta` (minutes), and the tail of `log` in a
`<pre className="overflow-x-auto">`.

Add this comment above the query, because it is a deliberate departure from `CLAUDE.md`:

```tsx
// Annotation progress is polled from the sidecar, not from job_service: the job lives in the
// sidecar's own process, which owns the subprocess and derives progress by counting lines in
// predictions.jsonl. Mirroring it into our job store would create a second source of truth.
```

- [ ] **Step 3: Add cancel**

A Cancel button, shown only while `running`, calling `cancelSam3Run(run)` then invalidating
`["sam3-status", ...]`. Confirm first via a shadcn dialog — it kills a GPU job.

- [ ] **Step 4: Verify**

Run `cd frontend && npx tsc --noEmit`. Against a GPU box: start a run, confirm the bar advances and
ETA appears, cancel it, and confirm polling stops and the button disappears.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sam3/Sam3RunsPanel.tsx frontend/src/pages/Sam3Studio.tsx
git commit -m "$(cat <<'EOF'
Add the SAM3 runs panel with live progress and cancel

Progress is read from the sidecar rather than mirrored into job_service,
since that job lives in the sidecar's process and it owns the truth.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Review screen — polygon canvas and decisions

**Files:**
- Create: `frontend/src/components/sam3/Sam3ReviewCanvas.tsx`
- Create: `frontend/src/components/sam3/Sam3ReviewPanel.tsx`
- Modify: `frontend/src/pages/Sam3Studio.tsx` (mount in the `Review` tab)

**Interfaces:**
- Consumes: `getSam3Review`, `getSam3Instances`, `postSam3Decision`, `sam3ImageUrl` (Task 6);
  `classColor` from `@/lib/yoloMath`.
- Produces:
  - `<Sam3ReviewCanvas imageUrl selectedIdx instances decisions onSelect onExemplarBox />`
  - `<Sam3ReviewPanel run={string} />`

- [ ] **Step 1: Build the polygon canvas**

Model it on `BBoxOverlayCanvas.tsx` — `<img>` plus an absolutely-positioned `<canvas>`, natural
size tracked in state, redraw on `ResizeObserver`. Differences:

- Draw each instance as a filled + stroked path over `inst.poly` (normalized x/y pairs scaled to
  display size), not a rect.
- Colour by `classColor(inst.cls)`, per the app's existing per-class convention. Never bake a
  colour into an instance.
- Style by decision state: accepted solid, rejected dashed at low opacity, undecided solid thin,
  selected drawn with a thicker stroke.
- Hit-test on click by point-in-polygon (ray casting) so clicking an instance selects it; call
  `onSelect(idx)`. Include the same few-pixels-of-slack reasoning as `AnnotationCanvas`: small
  instances are only a handful of screen pixels across.
- Support drag-to-draw one exemplar rect, reported normalized through
  `onExemplarBox([x1, y1, x2, y2])`, used by Task 10.

- [ ] **Step 2: Build the review queue**

`useQuery` on `["sam3-review", run, accept, reject]`. Render the list ordered as returned —
most-uncertain-first — with each item's `n_review` count. Selecting an item loads
`["sam3-instances", run, file]`. Note in a comment that the ordering is meaningful: a limited
review budget should be spent where the model is least sure.

- [ ] **Step 3: Wire the decision actions**

Buttons for Accept / Reject / Clear plus a class selector, each calling `postSam3Decision` and
invalidating `["sam3-instances", run, file]` and `["sam3-status", run]`. Decisions are per
instance index, keyed by the position in the `instances` array, matching the sidecar's
`decisions.json`.

- [ ] **Step 4: Add keyboard shortcuts**

A `keydown` listener matching the standalone tool exactly: `A` accept, `R` reject, `U` clear,
`1`-`9` set class, `ArrowLeft`/`ArrowRight` move between instances,
`ArrowUp`/`ArrowDown` move between images. Ignore events while an `input`/`textarea` has focus
(check `document.activeElement`), and clean the listener up on unmount.

- [ ] **Step 5: Verify**

Run `cd frontend && npx tsc --noEmit`. Against a run with predictions: confirm polygons render
aligned to objects at more than one window size, clicking selects, each of A/R/U/digit changes the
rendered state, the counts in the Runs tab move accordingly, and reloading the page shows the
decisions persisted.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/sam3/Sam3ReviewCanvas.tsx frontend/src/components/sam3/Sam3ReviewPanel.tsx frontend/src/pages/Sam3Studio.tsx
git commit -m "$(cat <<'EOF'
Add the SAM3 review workspace

A separate canvas from AnnotationCanvas, which is box-only and cannot draw
polygons. The queue stays in the sidecar's most-uncertain-first order so a
limited review budget lands where the model is least sure.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Gate controls, histogram, folder breakdown, exemplar refinement

**Files:**
- Create: `frontend/src/components/sam3/Sam3GatePanel.tsx`
- Create: `frontend/src/components/sam3/Sam3RefinePanel.tsx`
- Modify: `frontend/src/components/sam3/Sam3ReviewPanel.tsx`

**Interfaces:**
- Consumes: `getSam3Status`, `refineSam3`, `adoptSam3` (Task 6); the `onExemplarBox` callback
  (Task 9).
- Produces:
  - `<Sam3GatePanel status={Sam3Status} accept={string} reject={string} onChange={(accept: string, reject: string) => void} />`
  - `<Sam3RefinePanel run={string} file={string} classes={{id: number; name: string}[]} exemplarBox={number[] | null} />`

- [ ] **Step 1: Build the gate controls**

Per-class accept/reject number inputs serialized to the sidecar's comma format
(`"0.85,0.85,0.75,0.70"`), plus a single-value mode. Include this note verbatim:

> The measured F1-optimal threshold ranged 0.70 (goggles) to 0.85 (person) on a real PPE set, so
> one global number gives up either precision or recall.

When `status.measured` is present, show its `source` and a "use measured" button that fills the
inputs from `measured.accept`. State that changing a threshold never re-runs the model — every
instance scoring ≥0.25 is already stored, so the gate is a filter over the JSONL.

- [ ] **Step 2: Build the histogram and folder breakdown**

Render `status.hist` as a bar chart spanning `hist_lo`→`hist_hi`, with the accept and reject
thresholds marked. Render `status.folders` as a table of name / images / instances / accepted.
Also surface `status.split_parts` with this explanation: YOLO-seg keeps only the largest blob of a
disjoint instance, so that count is a format limit being reported rather than a bug.

- [ ] **Step 3: Build exemplar refinement**

With an `exemplarBox` from the canvas: a "Find similar" button calling `refineSam3` with
`boxes: [box], labels: [1]`, an optional text prompt, and a threshold input. Render returned
instances with scores, then a class selector plus "Adopt" calling `adoptSam3`.

Two rules to encode, both from the SAM3 README's measured findings:

- Negative exemplars are a **hint**, never a delete. Label the control that way, and state that the
  reliable removal is Reject, which is a filter and cannot fail.
- Adopt **replaces** every instance for that image and clears its decisions, because the old
  indices stop meaning anything. Confirm before adopting, and say so in the dialog.

Disable Adopt while a run is active — the sidecar returns 409 for edits during a job.

- [ ] **Step 4: Verify**

Run `cd frontend && npx tsc --noEmit`. Against a run: move a threshold and confirm bucket counts
change instantly with no GPU work; confirm the histogram matches `status.hist`; drag an exemplar
box, find similar, and confirm results render; adopt into a class and confirm the canvas reloads
with the adopted instances and cleared decisions.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/sam3/Sam3GatePanel.tsx frontend/src/components/sam3/Sam3RefinePanel.tsx frontend/src/components/sam3/Sam3ReviewPanel.tsx
git commit -m "$(cat <<'EOF'
Add per-class gate controls, histogram and exemplar refinement

The gate is per class because the measured F1 optimum spans 0.70 to 0.85
across PPE classes. Negative exemplars are presented as a hint, not a
delete, since they were measured not to reliably suppress what they cover.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Export and import into a dataset

**Files:**
- Create: `frontend/src/components/sam3/Sam3ExportPanel.tsx`
- Modify: `frontend/src/pages/Sam3Studio.tsx` (mount in the `Export` tab)

**Interfaces:**
- Consumes: `exportSam3`, `previewSam3Export`, `importSam3Export` (Task 6); `listDatasetNames`
  from `@/api/datasets`; `useJobPolling`; `ProgressDialog`.
- Produces: `<Sam3ExportPanel run={string} />`.

- [ ] **Step 1: Build the export form**

Fields: output directory, accept/reject gates (prefilled from the Review tab's values), validation
fraction, `group_by_dir`, `copy_images`. Include this warning next to `group_by_dir` verbatim:

> Turn this on when subfolders are frames from one camera. 30 frames from one camera are
> near-duplicates — split them randomly and near-copies of training images land in validation,
> making the score fiction.

On success render the returned `manifest` in a `<pre>`, and `stderr` if non-empty.

- [ ] **Step 2: Build the import step**

After a successful export, call `previewSam3Export(out)` and show the classes and per-split counts
it reports. Then a destination dataset combobox (existing names from `listDatasetNames`, or a new
name), a prefix `Input` (uppercased, `maxLength={4}`, matching `MergeDataset.tsx`), and split
toggles.

- [ ] **Step 3: Show the class-name mapping before committing**

Compare the preview's class names against the destination dataset's classes (`getDataset`) and show
which map onto an existing id and which will be created. Offer a rename input per source class,
sent as `class_filter`. Include this note:

> Classes merge by exact, case-sensitive name. `goggle` will not match an existing `goggles` — it
> creates a new class.

Skip the comparison when the destination is a new dataset.

- [ ] **Step 4: Run the import as a job**

Call `importSam3Export`, then drive `ProgressDialog` with `useJobPolling`, exactly as
`MergeDataset.tsx` does. On completion, show `images_copied`, `labels_converted` and
`lines_skipped` from the job result, and link to `/datasets/{destination}`.

- [ ] **Step 5: Verify end to end**

Run `cd frontend && npx tsc --noEmit`. Then, against a real run: export to a temp directory,
import into a disposable `qa_sam3_ui` dataset, and confirm in `/datasets/qa_sam3_ui` that the class
list matches, image counts match the preview, and a spot-checked label file contains 5-token box
lines — not polygons. Then clean up:

```bash
curl -s -X DELETE "http://127.0.0.1:8000/api/datasets/qa_sam3_ui?confirm=true"
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/sam3/Sam3ExportPanel.tsx frontend/src/pages/Sam3Studio.tsx
git commit -m "$(cat <<'EOF'
Add SAM3 export and import into a dataset

Shows which source class names map onto existing ids before the merge
runs, because classes unify by exact case-sensitive name and a near-miss
silently creates a new class instead of matching.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Document the feature

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: documentation matching the shipped behavior.

- [ ] **Step 1: Update `CLAUDE.md`**

Under **Architecture**, note that `/api/sam3/*` proxies a separate, optional SAM3 sidecar over
`httpx`, that no SAM3 dependency may enter `backend/requirements.txt`, and that the app must keep
working with the sidecar absent. Under **Known gotchas**, add: SAM3 exports polygons, and
`seg_to_box` conversion must run before any merge because `rewrite_label_class_ids` copies extra
tokens through verbatim and `parse_label_file` would misread a polygon as a box.

- [ ] **Step 2: Update `README.md`**

Add a short SAM3 section: what it does, that it needs a CUDA GPU and gated weights, that it runs
separately (`python sam3_server.py`), where to set its URL, and that the feature is inert without it.

- [ ] **Step 3: Verify**

Re-read both files and confirm every claim matches what was actually built — especially the "no new
dependencies" claim against `git diff main -- backend/requirements.txt`, which must be empty.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "$(cat <<'EOF'
Document the SAM3 integration and its polygon conversion gotcha

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Commit summary

Twelve tasks, fourteen commits including the two already made:

| # | Commit | Task |
|---|---|---|
| 1 | Ignore local-only artifacts | done |
| 2 | Add design spec | done |
| 3 | Box hit-testing slack | 1 |
| 4 | Annotation class grid + shortcuts | 1 |
| 5 | Polygon-to-box conversion | 2 |
| 6 | Sidecar URL setting | 3 |
| 7 | Backend proxy | 4 |
| 8 | Import job | 5 |
| 9 | Frontend shell + gate | 6 |
| 10 | Run panel | 7 |
| 11 | Runs panel | 8 |
| 12 | Review workspace | 9 |
| 13 | Gate/histogram/refinement | 10 |
| 14 | Export + import | 11 |
| 15 | Docs | 12 |

## Verification gates

- `cd frontend && npx tsc --noEmit` must pass after every frontend task.
- `venv\Scripts\python.exe scripts\test_seg_to_box.py` must pass after Task 2 and still pass at the end.
- `git diff --stat -- backend/requirements.txt` must be **empty** at the end. A non-empty diff means
  the core constraint was violated.
- With the sidecar stopped: `/sam3` shows only the unreachable panel, and every other page works.
- Restart uvicorn after each backend change — there is no `--reload`.
