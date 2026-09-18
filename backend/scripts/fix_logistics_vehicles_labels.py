#!/usr/bin/env python
"""Strip Logistics_Vehicles' labels down to car/forklift/truck/van only.

    python backend/scripts/fix_logistics_vehicles_labels.py [--dry-run]

clone_logistics_vehicles.py copied every kept image's ORIGINAL 20-class label content unchanged
-- correct for image selection, wrong for what should be labelled: the dataset should only ever
show car/forklift/truck/van, not every one of Logistics' 20 classes.

SAFETY: label files are hardlinked to the original Logistics dataset (same inode) -- editing them
in place would corrupt the 94,724-image source. Every file here gets unlinked first, then a fresh,
independent file is written with the filtered content. Images are untouched (their hardlinks stay,
since pixel content never changes).

New vocabulary: 0=car, 1=forklift, 2=truck, 3=van (renumbered from Logistics' own ids 1, 4, 17, 18).
Everything else becomes an empty label -- the same true-negative pattern used everywhere else in
this project (an empty .txt, not a missing one).
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import DATASETS_DIR
from app.services import metadata_service
from app.utils.file_ops import file_size
from app.utils.yaml_io import save_data_yaml

DEST = DATASETS_DIR / "Logistics_Vehicles"
OLD_TO_NEW = {1: 0, 4: 1, 17: 2, 18: 3}  # car, forklift, truck, van
CLASSES = {0: "car", 1: "forklift", 2: "truck", 3: "van"}


def longpath(p: Path) -> str:
    s = str(p.resolve())
    return s if s.startswith("\\\\?\\") else "\\\\?\\" + s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    per_class = {c: 0 for c in CLASSES}
    now_empty = 0
    dropped_lines = 0
    counts = {"train": 0, "valid": 0, "test": 0}

    for split in ("train", "valid", "test"):
        lbl_dir = DEST / split / "labels"
        if not lbl_dir.exists():
            continue
        names = sorted(os.listdir(lbl_dir))
        for i, name in enumerate(names, 1):
            if not name.endswith(".txt"):
                continue
            counts[split] += 1
            path = lbl_dir / name
            with open(longpath(path), "r", encoding="utf-8") as f:
                lines = [l.strip() for l in f if l.strip()]

            out = []
            for line in lines:
                t = line.split()
                old_cls = int(t[0])
                if old_cls in OLD_TO_NEW:
                    new_cls = OLD_TO_NEW[old_cls]
                    out.append(f"{new_cls} {' '.join(t[1:])}")
                    per_class[new_cls] += 1
                else:
                    dropped_lines += 1
            if not out:
                now_empty += 1

            if not args.dry_run:
                os.unlink(longpath(path))  # break the hardlink to Logistics -- never write through it
                with open(longpath(path), "w", encoding="utf-8") as f:
                    f.write("\n".join(out) + ("\n" if out else ""))

            if i % 10000 == 0:
                print(f"[{split}] {i}/{len(names)}")

    print(f"\nsplit counts (images unchanged): {counts}")
    print(f"per-class instances (renumbered): {per_class}")
    print(f"images now with zero labels (true negatives): {now_empty}")
    print(f"non-vehicle lines dropped: {dropped_lines}")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    save_data_yaml(DEST / "data.yaml", CLASSES)
    metadata_service.update_class_mapping(
        "Logistics_Vehicles", CLASSES,
        {"source": "Logistics", "original_mapping": {"1": "car", "4": "forklift", "17": "truck", "18": "van"},
         "note": "stripped from Logistics' full 20 classes to only these 4"})
    metadata_service.record_history_event("Logistics_Vehicles", {
        "event": "labels_stripped_to_wanted_classes",
        "old_to_new": {str(k): v for k, v in OLD_TO_NEW.items()},
        "classes": {str(k): v for k, v in CLASSES.items()},
        "per_class_instances": per_class,
        "images_now_empty": now_empty,
        "non_vehicle_lines_dropped": dropped_lines,
        "note": "corrected from the initial clone, which wrongly kept all 20 original classes' "
                "label lines. Label files were hardlinked to Logistics; each was unlinked before "
                "being rewritten, so the source dataset's own labels are untouched.",
    })
    from app.services import dataset_service
    dataset_service.refresh_cached_summary("Logistics_Vehicles")
    print("\ndone")


if __name__ == "__main__":
    main()
