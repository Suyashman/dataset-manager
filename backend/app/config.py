from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
ROOT_DIR = BACKEND_DIR.parent

DATASETS_DIR = ROOT_DIR / "datasets"
UPLOADS_DIR = ROOT_DIR / "uploads"
METADATA_DIR = ROOT_DIR / "metadata"
LOGS_DIR = ROOT_DIR / "logs"
RUNS_DIR = ROOT_DIR / "runs"
INFERENCE_DIR = ROOT_DIR / "inference_outputs"

for d in (DATASETS_DIR, UPLOADS_DIR, METADATA_DIR, LOGS_DIR, RUNS_DIR, INFERENCE_DIR):
    d.mkdir(parents=True, exist_ok=True)

SETTINGS_FILE = METADATA_DIR / "settings.json"

PAD_WIDTH = 6
SPLITS = ("train", "valid", "test")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
