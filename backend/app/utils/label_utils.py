from pathlib import Path


def parse_label_file(path: Path) -> list[dict]:
    """Returns list of {class_id, x_center, y_center, width, height, raw_tokens}."""
    boxes = []
    if not path.exists():
        return boxes
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            tokens = line.split()
            try:
                boxes.append({
                    "class_id": int(tokens[0]),
                    "x_center": float(tokens[1]),
                    "y_center": float(tokens[2]),
                    "width": float(tokens[3]),
                    "height": float(tokens[4]),
                    "raw_tokens": tokens,
                })
            except (ValueError, IndexError):
                continue
    return boxes


def rewrite_label_class_ids(
    src_path: Path, dst_path: Path, remap: dict[int, int], drop_classes: set[int] | None = None
) -> list[str]:
    """Copy src label file to dst, rewriting token[0] (class id) per remap.

    Lines whose class id is in `drop_classes` are removed entirely (no warning — this is an
    intentional class filter, e.g. keeping only 'vest' boxes out of a multi-class source).
    Lines whose class id is in neither `remap` nor `drop_classes` are left untouched and
    flagged via the returned warnings, since that indicates an unexpected/unmapped class.
    """
    drop_classes = drop_classes or set()
    warnings = []
    if not src_path.exists():
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        dst_path.write_text("", encoding="utf-8")
        return warnings

    out_lines = []
    with open(src_path, "r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, start=1):
            stripped = line.rstrip("\n")
            if not stripped.strip():
                continue
            tokens = stripped.split(" ")
            try:
                old_id = int(tokens[0])
            except ValueError:
                warnings.append(f"{src_path.name}:{line_no} non-integer class id '{tokens[0]}'")
                out_lines.append(stripped)
                continue
            if old_id in drop_classes:
                continue
            if old_id in remap:
                tokens[0] = str(remap[old_id])
                out_lines.append(" ".join(tokens))
            else:
                warnings.append(f"{src_path.name}:{line_no} class id {old_id} not in remap table")
                out_lines.append(stripped)

    dst_path.parent.mkdir(parents=True, exist_ok=True)
    with open(dst_path, "w", encoding="utf-8") as f:
        f.write("\n".join(out_lines))
        if out_lines:
            f.write("\n")
    return warnings
