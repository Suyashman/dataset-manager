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

# Scratch space for one SAM3 import at a time: a box-format copy of a polygon export, built
# purely to be merged out of and then deleted. Deliberately not in the mkdir loop above.
SAM3_STAGING_DIR = UPLOADS_DIR / "_sam3_staging"

PAD_WIDTH = 6
SPLITS = ("train", "valid", "test")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
