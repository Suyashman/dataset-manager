"""One-off script: build PPE_Master_v2_YOLOv26 from 7 Roboflow sources under datasets/.
Same class taxonomy as build_ppe_master.py (yolov11 version) -- these are the same 7 datasets
re-exported in yolo26 format, with identical class names/order.

Two sources (WeldingHelmet_yolo26_src, PPEOriginal_yolo26_src) mix plain bboxes with
segmentation-polygon lines (Roboflow re-exported some annotations as polygons this time).
merge_multiple() copies label lines through untouched (only remapping the class id token), so
after merging we do a post-pass converting any polygon line (>5 tokens) to its enclosing
bounding box -- keeps the whole master dataset in plain YOLO detect format, consistent and
viewable in the review tool.

Run from backend/:  venv\\Scripts\\python.exe scripts\\build_ppe_master_yolov26.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import DATASETS_DIR, SPLITS
from app.services.merge_service import merge_multiple

DESTINATION = "PPE_Master_v2_YOLOv26"

SOURCES = [
    {
        "source": "PPE_Workplace_yolo26_src",
        "prefix": "PW6",
        "class_filter": {
            0: "boots", 1: "ear_protection", 2: "eyewear", 3: "gloves",
            4: "safetyhelmet", 5: "mask", 6: "person", 7: "reflective",
        },
    },
    {
        "source": "Gloves_yolo26_src",
        "prefix": "GL6",
        "class_filter": {0: "gloves"},
    },
    {
        "source": "Masks_yolo26_src",
        "prefix": "MK6",
        "class_filter": {1: "person", 2: "mask"},
    },
    {
        "source": "WeldingHelmet_yolo26_src",
        "prefix": "WH6",
        "class_filter": {0: "safetyhelmet"},
    },
    {
        "source": "ConstructionSafety_yolo26_src",
        "prefix": "CS6",
        "class_filter": {0: "safetyhelmet", 3: "person", 4: "reflective"},
    },
    {
        "source": "SafetyGoggles_yolo26_src",
        "prefix": "SG6",
        "class_filter": {
            0: "ear_protection", 1: "eyewear", 2: "safetyhelmet",
            3: "person", 4: "reflective",
        },
    },
    {
        "source": "PPEOriginal_yolo26_src",
        "prefix": "PO6",
        "class_filter": {1: "harness", 3: "ear_protection", 4: "eyewear"},
    },
]

SPLITS_TO_INCLUDE = ["train", "valid", "test"]


def progress_cb(current, total, message):
    print(f"[{current}/{total}] {message}")


def polygon_line_to_bbox(line: str) -> str:
    tokens = line.split()
    class_id = tokens[0]
    coords = [float(t) for t in tokens[1:]]
    xs, ys = coords[0::2], coords[1::2]
    x_min, x_max = min(xs), max(xs)
    y_min, y_max = min(ys), max(ys)
    x_center, y_center = (x_min + x_max) / 2, (y_min + y_max) / 2
    width, height = x_max - x_min, y_max - y_min
    return f"{class_id} {x_center:.6f} {y_center:.6f} {width:.6f} {height:.6f}"


def normalize_polygons_to_bboxes(dataset_name: str) -> tuple[int, int]:
    """Converts any non-5-token label line (segmentation polygon) into its axis-aligned
    bounding box, in place. Returns (files_changed, lines_changed)."""
    dataset_path = DATASETS_DIR / dataset_name
    files_changed = 0
    lines_changed = 0
    for split in SPLITS:
        labels_dir = dataset_path / split / "labels"
        if not labels_dir.exists():
            continue
        for label_file in labels_dir.glob("*.txt"):
            text = label_file.read_text(encoding="utf-8")
            lines = [ln for ln in text.splitlines() if ln.strip()]
            if not lines:
                continue
            new_lines = []
            file_changed = False
            for line in lines:
                if len(line.split()) != 5:
                    new_lines.append(polygon_line_to_bbox(line))
                    file_changed = True
                    lines_changed += 1
                else:
                    new_lines.append(line)
            if file_changed:
                label_file.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
                files_changed += 1
    return files_changed, lines_changed


def main():
    print(f"Building '{DESTINATION}' from {len(SOURCES)} sources...")
    result = merge_multiple(DESTINATION, SOURCES, SPLITS_TO_INCLUDE, progress_cb=progress_cb)

    print("\n=== Merge done ===")
    print(f"Total images copied:  {result['images_copied']}")
    print(f"Total images skipped: {result['images_skipped']}")
    print("\nFinal unified classes:")
    for cid, name in sorted(result["unified_classes"].items(), key=lambda kv: int(kv[0])):
        print(f"  {cid}: {name}")

    print("\nPer-source breakdown:")
    for r in result["per_source"]:
        print(f"  {r['source']:28s} copied={r['images_copied']:5d} "
              f"skipped={r['images_skipped']:3d} splits={r['split_counts']}")
        if r["errors"]:
            print(f"    WARNINGS ({len(r['errors'])}): {r['errors'][:5]}")

    print("\n=== Normalizing segmentation-polygon lines to bounding boxes ===")
    files_changed, lines_changed = normalize_polygons_to_bboxes(DESTINATION)
    print(f"Converted {lines_changed} polygon line(s) across {files_changed} label file(s).")


if __name__ == "__main__":
    main()
