"""One-off script: build PPE_Master_v2 from 7 Roboflow sources under datasets/.
Bypasses the API/BackgroundTasks job layer -- runs synchronously to completion.
Run from backend/:  venv\\Scripts\\python.exe scripts\\build_ppe_master.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.merge_service import merge_multiple

DESTINATION = "PPE_Master_v2"

SOURCES = [
    {
        "source": "PPE_Workplace_src",
        "prefix": "PW",
        "class_filter": {
            0: "boots", 1: "ear_protection", 2: "eyewear", 3: "gloves",
            4: "safetyhelmet", 5: "mask", 6: "person", 7: "reflective",
        },
    },
    {
        "source": "Gloves_src",
        "prefix": "GL",
        "class_filter": {0: "gloves"},
    },
    {
        "source": "Masks_src",
        "prefix": "MK",
        "class_filter": {1: "person", 2: "mask"},
    },
    {
        "source": "WeldingHelmet_src",
        "prefix": "WH",
        "class_filter": {0: "safetyhelmet"},
    },
    {
        "source": "ConstructionSafety_src",
        "prefix": "CS",
        "class_filter": {0: "safetyhelmet", 3: "person", 4: "reflective"},
    },
    {
        "source": "SafetyGoggles_src",
        "prefix": "SG",
        "class_filter": {
            0: "ear_protection", 1: "eyewear", 2: "safetyhelmet",
            3: "person", 4: "reflective",
        },
    },
    {
        "source": "PPEOriginal_src",
        "prefix": "PO",
        "class_filter": {1: "harness", 3: "ear_protection", 4: "eyewear"},
    },
]

SPLITS = ["train", "valid", "test"]


def progress_cb(current, total, message):
    print(f"[{current}/{total}] {message}")


def main():
    print(f"Building '{DESTINATION}' from {len(SOURCES)} sources...")
    result = merge_multiple(DESTINATION, SOURCES, SPLITS, progress_cb=progress_cb)

    print("\n=== Done ===")
    print(f"Total images copied:  {result['images_copied']}")
    print(f"Total images skipped: {result['images_skipped']}")
    print("\nFinal unified classes:")
    for cid, name in sorted(result["unified_classes"].items(), key=lambda kv: int(kv[0])):
        print(f"  {cid}: {name}")

    print("\nPer-source breakdown:")
    for r in result["per_source"]:
        print(f"  {r['source']:24s} copied={r['images_copied']:5d} "
              f"skipped={r['images_skipped']:3d} splits={r['split_counts']}")
        if r["errors"]:
            print(f"    WARNINGS ({len(r['errors'])}): {r['errors'][:5]}")


if __name__ == "__main__":
    main()
