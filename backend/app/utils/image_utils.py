from pathlib import Path

from PIL import Image, UnidentifiedImageError


def get_image_resolution(path: Path) -> tuple[int, int] | None:
    try:
        with Image.open(path) as img:
            return img.size
    except (UnidentifiedImageError, OSError):
        return None


def is_image_corrupted(path: Path) -> bool:
    try:
        with Image.open(path) as img:
            img.verify()
        return False
    except (UnidentifiedImageError, OSError):
        return True
