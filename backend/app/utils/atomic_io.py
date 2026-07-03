import json
import os
import tempfile
import time
from pathlib import Path
from typing import Any

_REPLACE_RETRY_ATTEMPTS = 5
_REPLACE_RETRY_DELAY_SECONDS = 0.1


def atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp_", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
        # On Windows, os.replace can transiently fail with PermissionError/WinError 5 if
        # another process (e.g. a second backend instance, or AV) briefly has the destination
        # file open. Retry a few times before giving up, instead of dropping the write.
        last_error: OSError | None = None
        for attempt in range(_REPLACE_RETRY_ATTEMPTS):
            try:
                os.replace(tmp_path, path)
                return
            except PermissionError as e:
                last_error = e
                if attempt < _REPLACE_RETRY_ATTEMPTS - 1:
                    time.sleep(_REPLACE_RETRY_DELAY_SECONDS)
        raise last_error
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return default
