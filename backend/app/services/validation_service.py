
from app.config import SPLITS
from app.services import yolo_service
from app.utils.errors import DatasetNotFoundError
from app.utils.file_ops import compute_file_hash, iter_image_files
from app.utils.image_utils import is_image_corrupted


def _build_context(dataset_name: str) -> dict:
    path = yolo_service.dataset_path(dataset_name)
    if not path.exists():
        raise DatasetNotFoundError(f"Dataset '{dataset_name}' not found")
    classes = yolo_service.get_classes(dataset_name)
    split_files = {}
    for split in SPLITS:
        images = list(iter_image_files(path / split / "images"))
        labels_dir = path / split / "labels"
        labels = sorted(labels_dir.glob("*.txt")) if labels_dir.exists() else []
        split_files[split] = {"images": images, "labels": labels}
    return {"path": path, "classes": classes, "split_files": split_files}


def _check_missing_labels(ctx) -> list[dict]:
    issues = []
    for split, files in ctx["split_files"].items():
        label_stems = {f.stem for f in files["labels"]}
        for img in files["images"]:
            if img.stem not in label_stems:
                issues.append({"check": "missing_labels", "severity": "error", "split": split, "file": img.name, "message": f"Image '{img.name}' has no matching label file"})
    return issues


def _check_missing_images(ctx) -> list[dict]:
    issues = []
    for split, files in ctx["split_files"].items():
        image_stems = {f.stem for f in files["images"]}
        for lbl in files["labels"]:
            if lbl.stem not in image_stems:
                issues.append({"check": "missing_images", "severity": "error", "split": split, "file": lbl.name, "message": f"Label '{lbl.name}' has no matching image file"})
    return issues


def _check_duplicate_filenames(ctx) -> list[dict]:
    stem_to_splits: dict[str, list[str]] = {}
    for split, files in ctx["split_files"].items():
        for img in files["images"]:
            stem_to_splits.setdefault(img.stem, []).append(split)
    issues = []
    for stem, splits in stem_to_splits.items():
        if len(splits) > 1:
            issues.append({"check": "duplicate_filenames", "severity": "warning", "file": stem, "message": f"Filename '{stem}' appears in multiple splits: {splits}", "details": {"splits": splits}})
    return issues


def _check_duplicate_images_by_hash(ctx) -> list[dict]:
    hash_map: dict[str, list[str]] = {}
    for split, files in ctx["split_files"].items():
        for img in files["images"]:
            try:
                h = compute_file_hash(img)
            except OSError:
                continue
            hash_map.setdefault(h, []).append(f"{split}/{img.name}")
    issues = []
    for paths in hash_map.values():
        if len(paths) > 1:
            issues.append({"check": "duplicate_images", "severity": "warning", "message": f"{len(paths)} identical images found", "details": {"files": paths}})
    return issues


def _check_duplicate_class_names(ctx) -> list[dict]:
    name_to_ids: dict[str, list[int]] = {}
    for cid, name in ctx["classes"].items():
        name_to_ids.setdefault(name.lower(), []).append(cid)
    issues = []
    for name, ids in name_to_ids.items():
        if len(ids) > 1:
            issues.append({"check": "duplicate_class_names", "severity": "error", "message": f"Class name '{name}' used for multiple ids: {ids}", "details": {"ids": ids}})
    return issues


def _check_corrupted_images(ctx) -> list[dict]:
    issues = []
    for split, files in ctx["split_files"].items():
        for img in files["images"]:
            if is_image_corrupted(img):
                issues.append({"check": "corrupted_images", "severity": "error", "split": split, "file": img.name, "message": f"Image '{img.name}' could not be opened/verified"})
    return issues


def _check_empty_label_files(ctx) -> list[dict]:
    issues = []
    for split, files in ctx["split_files"].items():
        for lbl in files["labels"]:
            text = lbl.read_text(encoding="utf-8", errors="ignore").strip()
            if not text:
                issues.append({"check": "empty_label_files", "severity": "info", "split": split, "file": lbl.name, "message": f"Label file '{lbl.name}' has no annotations"})
    return issues


def _check_invalid_label_lines(ctx) -> list[dict]:
    issues = []
    nc = len(ctx["classes"])
    for split, files in ctx["split_files"].items():
        for lbl in files["labels"]:
            with open(lbl, "r", encoding="utf-8", errors="ignore") as f:
                for line_no, line in enumerate(f, start=1):
                    stripped = line.strip()
                    if not stripped:
                        continue
                    tokens = stripped.split()
                    if len(tokens) < 5:
                        issues.append({"check": "invalid_label_lines", "severity": "error", "split": split, "file": lbl.name, "line_number": line_no, "message": "malformed_line: expected at least 5 tokens"})
                        continue
                    try:
                        class_id = int(tokens[0])
                        coords = [float(t) for t in tokens[1:5]]
                    except ValueError:
                        issues.append({"check": "invalid_label_lines", "severity": "error", "split": split, "file": lbl.name, "line_number": line_no, "message": "malformed_line: non-numeric tokens"})
                        continue
                    if class_id < 0 or (nc and class_id >= nc):
                        issues.append({"check": "invalid_label_lines", "severity": "error", "split": split, "file": lbl.name, "line_number": line_no, "message": f"invalid_class_id: {class_id} (nc={nc})"})
                    if any(c < 0.0 or c > 1.0 for c in coords):
                        issues.append({"check": "invalid_label_lines", "severity": "error", "split": split, "file": lbl.name, "line_number": line_no, "message": "bad_coordinate_range: coordinates must be within [0,1]"})
                    else:
                        x, y, w, h = coords
                        if x - w / 2 < 0 or x + w / 2 > 1 or y - h / 2 < 0 or y + h / 2 > 1:
                            issues.append({"check": "invalid_label_lines", "severity": "warning", "split": split, "file": lbl.name, "line_number": line_no, "message": "box_out_of_bounds: box extends outside image bounds"})
    return issues


def run_validation(dataset_name: str) -> dict:
    ctx = _build_context(dataset_name)
    issues: list[dict] = []
    issues += _check_missing_labels(ctx)
    issues += _check_missing_images(ctx)
    issues += _check_duplicate_filenames(ctx)
    issues += _check_duplicate_images_by_hash(ctx)
    issues += _check_duplicate_class_names(ctx)
    issues += _check_corrupted_images(ctx)
    issues += _check_empty_label_files(ctx)
    issues += _check_invalid_label_lines(ctx)

    summary: dict[str, int] = {}
    for issue in issues:
        summary[issue["check"]] = summary.get(issue["check"], 0) + 1

    return {"dataset": dataset_name, "issues": issues, "summary": summary}
