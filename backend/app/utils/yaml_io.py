from pathlib import Path

import yaml


def load_data_yaml(path: Path) -> dict:
    """Returns {classes: {int: str}, nc: int, raw: dict}. Normalizes names list/dict forms."""
    if not path.exists():
        return {"classes": {}, "nc": 0, "raw": {}}
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    names = raw.get("names", {})
    if isinstance(names, list):
        classes = {i: str(name) for i, name in enumerate(names)}
    elif isinstance(names, dict):
        classes = {int(k): str(v) for k, v in names.items()}
    else:
        classes = {}
    return {"classes": classes, "nc": raw.get("nc", len(classes)), "raw": raw}


def save_data_yaml(path: Path, classes: dict, dataset_root_relative: bool = True) -> None:
    ordered_names = [classes[i] for i in sorted(classes.keys())]
    data = {
        "train": "train/images",
        "val": "valid/images",
        "test": "test/images",
        "nc": len(ordered_names),
        "names": ordered_names,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, default_flow_style=None, sort_keys=False)
