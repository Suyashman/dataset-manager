import re
from pathlib import Path

from app.config import PAD_WIDTH, SPLITS


def zero_pad(n: int, width: int = PAD_WIDTH) -> str:
    return str(n).zfill(width)


def parse_existing_numbers_from_filenames(dataset_dir: Path, prefix: str, pad_width: int = PAD_WIDTH) -> int:
    """Scan images/{split}/ folders for files matching {prefix}{digits}.ext and return the max number found."""
    pattern = re.compile(rf"^{re.escape(prefix)}(\d{{{pad_width}}})\.")
    max_number = 0
    for split in SPLITS:
        images_dir = dataset_dir / split / "images"
        if not images_dir.exists():
            continue
        for f in images_dir.iterdir():
            m = pattern.match(f.name)
            if m:
                max_number = max(max_number, int(m.group(1)))
    return max_number
