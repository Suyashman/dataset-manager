import threading
from datetime import datetime, timezone

from app.config import DATASETS_DIR, METADATA_DIR, PAD_WIDTH
from app.services.logging_service import log_event
from app.utils.atomic_io import atomic_write_json, read_json
from app.utils.file_ops import validate_safe_name
from app.utils.numbering import parse_existing_numbers_from_filenames

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(dataset_name: str) -> threading.Lock:
    with _locks_guard:
        if dataset_name not in _locks:
            _locks[dataset_name] = threading.Lock()
        return _locks[dataset_name]


def _metadata_path(dataset_name: str):
    validate_safe_name(dataset_name, "dataset name")
    return METADATA_DIR / f"{dataset_name}.json"


def _default_metadata(dataset_name: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "schema_version": 1,
        "dataset_name": dataset_name,
        "created_at": now,
        "updated_at": now,
        "numbering": {},
        "classes": {"mapping": {}, "source_history": []},
        "history": [],
        "split_counts": {"train": 0, "valid": 0, "test": 0},
    }


def load_metadata(dataset_name: str) -> dict:
    data = read_json(_metadata_path(dataset_name), default=None)
    if data is None:
        return _default_metadata(dataset_name)
    return data


def save_metadata(dataset_name: str, data: dict) -> None:
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    atomic_write_json(_metadata_path(dataset_name), data)


def get_next_number(dataset_name: str, prefix: str, pad_width: int = PAD_WIDTH) -> int:
    """Increments and persists the numbering counter for prefix. Falls back to scanning
    existing files if metadata is missing/corrupted, repairing the metadata file."""
    validate_safe_name(prefix, "prefix")
    lock = _lock_for(dataset_name)
    with lock:
        path = _metadata_path(dataset_name)
        raw = read_json(path, default="CORRUPT_OR_MISSING")
        if raw == "CORRUPT_OR_MISSING" and path.exists():
            # file exists but failed to parse -> corrupted
            dataset_dir = DATASETS_DIR / dataset_name
            scanned = parse_existing_numbers_from_filenames(dataset_dir, prefix, pad_width)
            data = _default_metadata(dataset_name)
            data["numbering"][prefix] = {"last_number": scanned, "pad_width": pad_width}
            log_event("metadata_repaired", f"Repaired corrupted metadata for {dataset_name}, scanned last_number={scanned} for prefix {prefix}", dataset=dataset_name, level="WARNING")
        elif raw is None or raw == "CORRUPT_OR_MISSING":
            data = _default_metadata(dataset_name)
        else:
            data = raw

        numbering = data.setdefault("numbering", {})
        entry = numbering.get(prefix)
        if entry is None:
            dataset_dir = DATASETS_DIR / dataset_name
            scanned = parse_existing_numbers_from_filenames(dataset_dir, prefix, pad_width)
            entry = {"last_number": scanned, "pad_width": pad_width}

        next_number = entry["last_number"] + 1
        entry["last_number"] = next_number
        numbering[prefix] = entry

        save_metadata(dataset_name, data)
        return next_number


def clone_metadata(source: str, destination: str) -> None:
    """Seeds a new dataset's metadata from an existing one after its files have been physically
    copied (e.g. for augmentation). Carries over the class mapping and, critically, the
    numbering counters — the destination now contains files like H000001.jpg on disk, so its
    'H' counter must start there too, or a later merge/augment run would reuse those numbers
    and overwrite existing files."""
    lock = _lock_for(destination)
    with lock:
        src_data = load_metadata(source)
        data = _default_metadata(destination)
        data["classes"]["mapping"] = dict(src_data.get("classes", {}).get("mapping", {}))
        data["numbering"] = {k: dict(v) for k, v in src_data.get("numbering", {}).items()}
        data["split_counts"] = dict(src_data.get("split_counts", {"train": 0, "valid": 0, "test": 0}))
        data["history"] = [{"event": "cloned_from", "source_dataset": source, "timestamp": datetime.now(timezone.utc).isoformat()}]
        save_metadata(destination, data)


def record_history_event(dataset_name: str, event: dict) -> None:
    lock = _lock_for(dataset_name)
    with lock:
        data = load_metadata(dataset_name)
        event["timestamp"] = datetime.now(timezone.utc).isoformat()
        data.setdefault("history", []).append(event)
        save_metadata(dataset_name, data)


def update_class_mapping(dataset_name: str, mapping: dict[int, str], source_history_entry: dict) -> None:
    lock = _lock_for(dataset_name)
    with lock:
        data = load_metadata(dataset_name)
        data["classes"]["mapping"] = {str(k): v for k, v in mapping.items()}
        data["classes"].setdefault("source_history", []).append(source_history_entry)
        save_metadata(dataset_name, data)


def update_split_counts(dataset_name: str, splits: dict[str, int]) -> None:
    lock = _lock_for(dataset_name)
    with lock:
        data = load_metadata(dataset_name)
        counts = data.setdefault("split_counts", {"train": 0, "valid": 0, "test": 0})
        for split, n in splits.items():
            counts[split] = counts.get(split, 0) + n
        save_metadata(dataset_name, data)


def get_cached_summary(dataset_name: str) -> dict | None:
    """Cheap summary (split counts, total images, class count, size on disk) cached in
    metadata so listing datasets doesn't have to re-walk every file on every page load."""
    return load_metadata(dataset_name).get("cache")


def set_cached_summary(dataset_name: str, summary: dict) -> None:
    lock = _lock_for(dataset_name)
    with lock:
        data = load_metadata(dataset_name)
        data["cache"] = {**summary, "computed_at": datetime.now(timezone.utc).isoformat()}
        save_metadata(dataset_name, data)


def get_cached_validation(dataset_name: str) -> dict | None:
    """Validation re-hashes and re-decodes every image to check for duplicates/corruption —
    expensive on large datasets. Cached alongside a cheap stat-only fingerprint (see
    validation_service._compute_fingerprint) so unchanged datasets don't pay that cost on every
    tab visit; any file add/remove/edit changes the fingerprint and forces a fresh run."""
    return load_metadata(dataset_name).get("validation_cache")


def set_cached_validation(dataset_name: str, fingerprint: str, report: dict) -> None:
    lock = _lock_for(dataset_name)
    with lock:
        data = load_metadata(dataset_name)
        data["validation_cache"] = {"fingerprint": fingerprint, "report": report}
        save_metadata(dataset_name, data)
