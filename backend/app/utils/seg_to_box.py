from pathlib import Path


def _clamp(v: float) -> float:
    return min(max(v, 0.0), 1.0)


def seg_line_to_box_line(line: str) -> str | None:
    """One YOLO-seg polygon line -> one YOLO detection line, or None if unusable.

    The bounding box is recomputed over EVERY vertex. This is not cosmetic: nothing
    downstream can tell a polygon line from a box line, and parse_label_file reads
    tokens[1:5] as cx/cy/w/h — so an unconverted polygon silently becomes a box built
    from its first two vertices.

    A 4-value payload is already a detection box and passes through reformatted, so this
    is safe to run over a mixed directory.
    """
    parts = line.split()
    if len(parts) < 5:
        return None
    try:
        cls = int(float(parts[0]))
        vals = [float(v) for v in parts[1:]]
    except ValueError:
        return None

    if len(vals) == 4:
        cx, cy, w, h = vals
    else:
        # A polygon needs at least 3 vertices, hence 6 values, in x/y pairs.
        if len(vals) < 6 or len(vals) % 2:
            return None
        xs, ys = vals[0::2], vals[1::2]
        x1, x2, y1, y2 = min(xs), max(xs), min(ys), max(ys)
        cx, cy, w, h = (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1

    w, h = _clamp(w), _clamp(h)
    if w <= 0 or h <= 0:
        return None
    return f"{cls} {_clamp(cx):.6f} {_clamp(cy):.6f} {w:.6f} {h:.6f}"


def convert_label_file(src: Path, dst: Path) -> tuple[int, int]:
    """Convert one label file. Returns (lines_written, lines_skipped).

    Always writes dst, even when nothing survives: an empty .txt teaches Ultralytics that
    the image is a true negative, while a MISSING .txt makes it skip the image entirely.
    Those are different datasets.
    """
    out, skipped = [], 0
    if src.exists():
        for raw in src.read_text(encoding="utf-8").splitlines():
            if not raw.strip():
                continue
            converted = seg_line_to_box_line(raw)
            if converted is None:
                skipped += 1
            else:
                out.append(converted)

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text("\n".join(out) + ("\n" if out else ""), encoding="utf-8")
    return len(out), skipped
