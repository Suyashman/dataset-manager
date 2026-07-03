import hashlib
import shutil
from pathlib import Path
from typing import Iterator

from app.config import IMAGE_EXTENSIONS
from app.utils.errors import PathTraversalError


def safe_path_join(base: Path, *parts: str) -> Path:
    candidate = base.joinpath(*parts).resolve()
    base_resolved = base.resolve()
    if base_resolved not in candidate.parents and candidate != base_resolved:
        raise PathTraversalError(f"Path escapes base directory: {candidate}")
    return candidate


def iter_image_files(directory: Path) -> Iterator[Path]:
    if not directory.exists():
        return
    for p in sorted(directory.iterdir()):
        if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS:
            yield p


def copy_file_safe(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def compute_file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def get_dir_size(directory: Path) -> int:
    total = 0
    if not directory.exists():
        return 0
    for p in directory.rglob("*"):
        if p.is_file():
            total += p.stat().st_size
    return total
