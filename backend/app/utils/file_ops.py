import hashlib
import re
import shutil
from pathlib import Path
from typing import Iterator

from app.config import IMAGE_EXTENSIONS
from app.utils.errors import PathTraversalError

# Dataset names and numbering prefixes get embedded directly into filesystem paths (as a
# directory name, or as a filename prefix like "H000001.jpg"). Without this check, a value like
# "../../etc" or containing a backslash would let a request escape DATASETS_DIR/METADATA_DIR
# entirely — see the path-traversal finding from the QA audit. safe_path_join alone doesn't
# catch this because it only validates *joined* segments, not a value baked into a single
# path component before being combined with `/`.
_SAFE_NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._-]*$")


def validate_safe_name(name: str, field: str = "name") -> str:
    if not name or ".." in name or "/" in name or "\\" in name or not _SAFE_NAME_PATTERN.match(name):
        raise PathTraversalError(f"Invalid {field}: {name!r}")
    return name


def safe_path_join(base: Path, *parts: str) -> Path:
    candidate = base.joinpath(*parts).resolve()
    base_resolved = base.resolve()
    if base_resolved not in candidate.parents and candidate != base_resolved:
        raise PathTraversalError(f"Path escapes base directory: {candidate}")
    return candidate


# Every caller here re-lists and re-sorts the whole directory — fine for a handful of files,
# but list_images fetches images one at a time (page_size=1) during annotation review, so a
# 4000+ file split directory was getting fully re-scanned on every single "Next" click (measured
# 500ms-1.3s per call on a ~5500-image dataset). Cached by directory mtime, which NTFS updates on
# any file add/remove/rename within it — no manual invalidation needed, and content edits to an
# existing file don't change the listing anyway so they don't need to invalidate it.
_image_listing_cache: dict[Path, tuple[float, list[Path]]] = {}


def iter_image_files(directory: Path) -> Iterator[Path]:
    if not directory.exists():
        return
    mtime = directory.stat().st_mtime
    cached = _image_listing_cache.get(directory)
    if cached is not None and cached[0] == mtime:
        yield from cached[1]
        return
    files = [p for p in sorted(directory.iterdir()) if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS]
    _image_listing_cache[directory] = (mtime, files)
    yield from files


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
