#!/usr/bin/env python
"""Self-check for polygon -> box conversion. No pytest, just asserts.

    python backend/scripts/test_seg_to_box.py

This is the logic that silently corrupts a dataset if it breaks: a polygon line copied
through unconverted is read by parse_label_file as a box built from the polygon's first
two vertices.
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.utils.seg_to_box import convert_label_file, seg_line_to_box_line

# --- a triangle's bounding box comes from every vertex, not the first two ----
line = seg_line_to_box_line("3 0.2 0.2 0.8 0.3 0.5 0.9")
assert line == "3 0.500000 0.550000 0.600000 0.700000", line
print("ok  triangle -> bbox over all vertices")

# --- an already-4-value detection line passes through, reformatted -----------
assert seg_line_to_box_line("0 0.5 0.5 0.25 0.25") == "0 0.500000 0.500000 0.250000 0.250000"
print("ok  detection line passes through")

# --- coordinates are clamped to [0,1] ---------------------------------------
out = seg_line_to_box_line("1 -0.1 -0.1 1.4 0.5 0.5 1.2")
vals = [float(v) for v in out.split()[1:]]
assert all(0.0 <= v <= 1.0 for v in vals), out
print("ok  coordinates clamped to [0,1]")

# --- class id survives, including a float-formatted one ---------------------
assert seg_line_to_box_line("7 0.1 0.1 0.2 0.2 0.3 0.3").startswith("7 ")
assert seg_line_to_box_line("7.0 0.1 0.1 0.2 0.2 0.3 0.3").startswith("7 ")
print("ok  class id preserved")

# --- garbage produces None rather than a corrupt line -----------------------
for bad in ("", "   ", "0", "0 0.1 0.1", "x 0.1 0.1 0.2 0.2 0.3 0.3",
            "0 0.1 0.1 0.2 0.2 0.3"):
    assert seg_line_to_box_line(bad) is None, bad
print("ok  unparseable lines rejected")

# --- a zero-area polygon is degenerate, not a box ---------------------------
assert seg_line_to_box_line("0 0.5 0.5 0.5 0.5 0.5 0.5") is None
print("ok  zero-area polygon rejected")

# --- file conversion, including the empty-file rule -------------------------
with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    src = td / "a.txt"
    src.write_text("0 0.2 0.2 0.8 0.3 0.5 0.9\ngarbage\n1 0.1 0.1 0.4 0.1 0.4 0.4\n")
    dst = td / "out" / "a.txt"
    written, skipped = convert_label_file(src, dst)
    assert (written, skipped) == (2, 1), (written, skipped)
    lines = dst.read_text().splitlines()
    assert len(lines) == 2 and all(len(l.split()) == 5 for l in lines), lines

    # An image with no instances must get an EMPTY .txt, never a missing one:
    # missing makes Ultralytics skip the image, empty teaches it a true negative.
    empty_src = td / "b.txt"
    empty_src.write_text("")
    empty_dst = td / "out" / "b.txt"
    assert convert_label_file(empty_src, empty_dst) == (0, 0)
    assert empty_dst.exists() and empty_dst.read_text() == ""
print("ok  file conversion writes boxes and preserves empty labels")

print("\nall checks passed")
