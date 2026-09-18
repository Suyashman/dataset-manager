import hashlib
import os
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
    # os.scandir(), not Path.iterdir()+Path.is_file(): on Windows, Path.is_file() does a fresh
    # per-entry stat() against the individual file's full path and silently returns False (it
    # swallows OSError rather than raising) once that path exceeds the 260-char MAX_PATH -- which
    # a dataset with long source filenames (seen in practice: Roboflow's own '<name>_jpg.rf.<hash>'
    # scheme, and worse, base64-looking names over 300 chars from some re-hosted sources) hits for
    # real files. scandir's DirEntry.is_file() answers from the directory-enumeration handle
    # itself, never touching the individual path, so it doesn't have this failure mode. Silently
    # dropping files here isn't cosmetic: it means Annotate/Clean Dataset pagination and every
    # count derived from this function skip real images without any error surfacing.
    with os.scandir(directory) as it:
        # Sort by a bare-name Path, not the raw string: pathlib's comparison is case-insensitive
        # on Windows (matching NTFS), which a plain e.name string sort is not -- this keeps the
        # exact ordering sorted(directory.iterdir()) produced, so pagination order doesn't shift
        # as a side effect of the long-path fix.
        entries = sorted(it, key=lambda e: Path(e.name))
    files = [directory / e.name for e in entries
             if e.is_file() and Path(e.name).suffix.lower() in IMAGE_EXTENSIONS]
    _image_listing_cache[directory] = (mtime, files)
    yield from files


def file_size(path: Path) -> int:
    """path.stat().st_size, but safe for paths beyond Windows' 260-char MAX_PATH.

    iter_image_files() now correctly yields long-path files instead of silently hiding them (see
    above) -- which means any caller still doing plain path.stat() on its results will raise
    FileNotFoundError on exactly those files instead of just under-counting them. Use this instead
    wherever a size is needed for a path that came from iter_image_files() or a raw directory
    listing, so fixing the listing bug doesn't turn a silent undercount into a crash.
    """
    s = str(path.resolve())
    if not s.startswith("\\\\?\\"):
        s = "\\\\?\\" + s
    import os as _os
    return _os.stat(s).st_size


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
    # os.scandir(), same reasoning as iter_image_files: Path.rglob()+Path.is_file()/.stat() do a
    # fresh per-entry stat against the full path and silently skip (is_file() swallows the error)
    # or raise (stat()) once a path exceeds 260 chars. DirEntry.is_file()/.stat() answer from the
    # scandir handle itself and don't have that failure mode.
    total = 0
    if not directory.exists():
        return 0
    with os.scandir(directory) as it:
        for entry in it:
            if entry.is_dir(follow_symlinks=False):
                total += get_dir_size(Path(entry.path))
            elif entry.is_file():
                total += entry.stat().st_size
    return total
