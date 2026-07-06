# YOLO Dataset Manager

A local-only tool for the full YOLO dataset lifecycle: creating and merging datasets from
Roboflow exports, annotating your own images from scratch, augmenting data, training models, and
testing them — all running against your own filesystem, no cloud, no account.

This is **not** a cloud app — it runs entirely on your machine.

## Project layout

```
backend/              FastAPI app (Python)
frontend/              React + Vite + Tailwind + shadcn/ui
datasets/              Your YOLO datasets live here (each subfolder is one dataset)
runs/                  Trained model checkpoints (best.pt / last.pt) from Train Model
inference_outputs/     Saved annotated images/videos from Inference Studio
uploads/                Staging area for uploads (dataset zips, videos for inference)
metadata/               Per-dataset metadata.json (numbering, class mapping, history) + settings.json
logs/                   Daily JSON-lines activity logs
```

## Prerequisites

- Python 3.10+
- Node 18+
- (Optional) An NVIDIA GPU + driver for GPU-accelerated training/inference — CPU works fine
  otherwise, just slower.

## Getting started

### Backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

This pulls in CPU-only PyTorch by default (as a dependency of `ultralytics`). **If you have an
NVIDIA GPU and want GPU training/inference**, reinstall torch with a CUDA build matching your
driver right after (check what CUDA version your driver supports first — this project was built
against CUDA 12.4):

```powershell
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
```

Then start the server:

```powershell
uvicorn app.main:app --port 8000
```

Deliberately **no `--reload`** — the app runs long background jobs (training, video inference,
bulk augmentation) as background tasks in the same process, and `--reload`'s file-watcher will
kill and restart the whole process (silently aborting any in-progress job) the moment any file
changes, including ones you didn't mean to trigger a restart. Only use `--reload` if you're
actively editing backend code and aren't running anything long.

### Frontend

```powershell
cd frontend
npm install
npm run dev -- --host
```

Open http://localhost:5173 — the Vite dev server proxies `/api` to `http://localhost:8000`.

### Everyday use: one-click start

Once the one-time setup above is done, double-click **`start.bat`** in the project root instead
of typing both commands by hand. It opens two console windows (backend and frontend) and opens
your browser to the app once both are up. Close both console windows to stop the app.

If you're using Claude Code with this repo, `.claude/launch.json` has both servers pre-configured
— but the backend entry's `runtimeExecutable` is an absolute path to *this machine's* venv, so
update it to your own venv location on a new machine.

## Using it

- **Create Dataset** — copy a Roboflow-format export into a new, properly-numbered dataset (e.g.
  `H000001.jpg`).
- **Merge Dataset** — fold one or more additional exports into an existing (or new) dataset in one
  operation; classes are unified by name automatically, with per-source class filtering/renaming,
  and every label file is rewritten with correct class ids.
- **Annotate** — point at a local folder of your own images, import them, and draw bounding boxes
  directly in the browser (draw/move/resize/delete, per-box class assignment) to build a dataset
  from scratch — no Roboflow export needed.
- **Augment Dataset** — clone a dataset and add flip/rotate/HSV/blur/noise-augmented copies of the
  train split, each technique in its own numbering prefix.
- **Train Model** — pick a dataset, model size, hyperparameters (lr, epochs, batch, early-stop
  patience), CPU or GPU, and watch live per-batch progress and loss/mAP charts. Supports
  resuming an interrupted run or fine-tuning from a previous checkpoint.
- **Inference Studio** — test a trained model on a single image, a batch of images, a video file,
  or your live webcam, with adjustable confidence/IoU and reported inference speed.
- **Datasets / Dataset Statistics** — inspect class balance, validation issues (missing labels,
  duplicates, corrupted images, malformed annotations), and preview images with bounding box
  overlays.

## Numbering

Images and labels are renamed `{PREFIX}{NUMBER:06d}` (e.g. `H000001.jpg` / `H000001.txt`),
continuing monotonically for a given prefix within a dataset. This is tracked per-prefix in
`metadata/{dataset}.json`; if that file is missing or corrupted, the next number is recovered by
scanning existing filenames.

## Moving data to another machine

`datasets/`, `runs/`, `inference_outputs/`, `uploads/`, and `metadata/*.json` are gitignored —
cloning this repo gets you a working app with zero datasets in it. To bring existing data along,
copy those folders directly (they can be sizeable — trained weights and image sets add up).
`inference_outputs/` is safe to skip; everything in it is easy to regenerate.
