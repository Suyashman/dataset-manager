import json
from datetime import datetime, timezone

from app.config import LOGS_DIR


def log_event(category: str, message: str, level: str = "INFO", dataset: str | None = None, **details) -> None:
    now = datetime.now(timezone.utc)
    entry = {
        "timestamp": now.isoformat(),
        "level": level,
        "category": category,
        "dataset": dataset,
        "message": message,
        "details": details,
    }
    log_file = LOGS_DIR / f"{now.strftime('%Y-%m-%d')}.log"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, default=str) + "\n")


def list_log_dates() -> list[str]:
    if not LOGS_DIR.exists():
        return []
    return sorted([p.stem for p in LOGS_DIR.glob("*.log")], reverse=True)


def read_log(date: str, lines: int = 200) -> list[dict]:
    log_file = LOGS_DIR / f"{date}.log"
    if not log_file.exists():
        return []
    with open(log_file, "r", encoding="utf-8") as f:
        all_lines = f.readlines()
    out = []
    for line in all_lines[-lines:]:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out
