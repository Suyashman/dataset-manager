#!/usr/bin/env python
"""Convert the SAM3 FACTORY_PPE_DATASET export into a Dataset Manager dataset.

    python backend/scripts/convert_factory_ppe.py [--dry-run]

The export is YOLO *segmentation* (polygons) in a flat images/ + labels/ layout, with the
train/val split carried by train.txt and val.txt. This app needs YOLO *detection* boxes in
train|valid|test/{images,labels} plus a data.yaml. This does that conversion, and drops the
classes that have no usable instances.

Class decision (see the export's own FINDINGS.md):

    0 person   19589 instances  -> kept as 0
    1 helmet    6694 instances  -> kept as 1, renamed 'hardhat'
    2 safety_vest   7 instances -> DROPPED
    3 welding_helmet 0          -> DROPPED
    4 gloves         0          -> DROPPED

safety_vest is dropped rather than carried: 7 instances across 11,086 images, scattered one
apiece over six different cameras, is the signature of false positives rather than a real
population. FINDINGS.md reached the same conclusion independently from the ISV violation
database, where 0 of 23,470 PPE violations in 30 days were 'reflective'. A class the model
cannot learn still distorts mAP, so it is better out than in.

Images are hardlinked, not copied: 5.6 GB, same volume, and a hardlink is refcounted, so
deleting the original export later does not disturb this dataset.

Filenames keep their original camera-prefixed names rather than being renumbered to the app's
{PREFIX}{000001} convention. The camera is the provenance that makes the split meaningful --
frames from one fixed camera are near-duplicates, which is why the split is grouped by camera
in the first place -- and the numbering convention only matters for the merge/import flows.
"""
import argparse
import json
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import DATASETS_DIR
from app.services import metadata_service
from app.utils.seg_to_box import seg_line_to_box_line
from app.utils.yaml_io import save_data_yaml

SOURCE = DATASETS_DIR / "FACTORY_PPE_DATASET" / "FACTORY_PPE_DATASET"
DEST_NAME = "FACTORY_PPE_YOLO"

# old class id -> (new class id, new name). Anything absent is dropped.
KEEP = {0: (0, "person"), 1: (1, "hardhat")}


def link_or_copy(src: Path, dst: Path) -> None:
    if dst.exists():
        return
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def read_split(path: Path) -> list[str]:
    """train.txt / val.txt hold './images/<name>.jpg' per line."""
    return [line.strip().split("/")[-1] for line in path.read_text().splitlines() if line.strip()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report what would happen, write nothing")
    args = ap.parse_args()

    if not (SOURCE / "data.yaml").exists():
        sys.exit(f"source export not found at {SOURCE}")

    dest = DATASETS_DIR / DEST_NAME
    splits = {"train": read_split(SOURCE / "train.txt"), "valid": read_split(SOURCE / "val.txt")}
    print(f"source : {SOURCE}")
    print(f"dest   : {dest}")
    print(f"split  : {len(splits['train'])} train + {len(splits['valid'])} valid")

    if args.dry_run:
        print("\n--dry-run: nothing written")

    per_class = {new: 0 for new, _ in KEEP.values()}
    dropped = {}
    split_counts = {"train": 0, "valid": 0, "test": 0}
    empty_labels = 0
    bad_lines = 0

    for split, names in splits.items():
        if not args.dry_run:
            (dest / split / "images").mkdir(parents=True, exist_ok=True)
            (dest / split / "labels").mkdir(parents=True, exist_ok=True)

        for i, name in enumerate(names, 1):
            src_img = SOURCE / "images" / name
            src_lbl = SOURCE / "labels" / f"{Path(name).stem}.txt"
            if not src_img.exists():
                print(f"  missing image, skipped: {name}")
                continue

            out_lines = []
            for raw in src_lbl.read_text(encoding="utf-8").splitlines():
                if not raw.strip():
                    continue
                try:
                    old_cls = int(float(raw.split()[0]))
                except (ValueError, IndexError):
                    bad_lines += 1
                    continue
                if old_cls not in KEEP:
                    dropped[old_cls] = dropped.get(old_cls, 0) + 1
                    continue
                box = seg_line_to_box_line(raw)
                if box is None:
                    bad_lines += 1
                    continue
                new_cls = KEEP[old_cls][0]
                # seg_line_to_box_line preserves the original id; swap in the remapped one.
                out_lines.append(f"{new_cls} {box.split(' ', 1)[1]}")
                per_class[new_cls] += 1

            if not args.dry_run:
                link_or_copy(src_img, dest / split / "images" / name)
                # An image with nothing in it gets an EMPTY .txt, never a missing one: missing
                # makes Ultralytics skip the image, empty teaches it a true negative.
                (dest / split / "labels" / f"{Path(name).stem}.txt").write_text(
                    "\n".join(out_lines) + ("\n" if out_lines else ""), encoding="utf-8"
                )

            split_counts[split] += 1
            empty_labels += not out_lines
            if i % 1000 == 0:
                print(f"  {split}: {i}/{len(names)}")

    classes = {new: name for new, name in KEEP.values()}
    if not args.dry_run:
        (dest / "test" / "images").mkdir(parents=True, exist_ok=True)
        (dest / "test" / "labels").mkdir(parents=True, exist_ok=True)
        save_data_yaml(dest / "data.yaml", classes)
        metadata_service.update_class_mapping(
            DEST_NAME,
            classes,
            {"dataset": "FACTORY_PPE_DATASET", "original_mapping": json.loads(
                (SOURCE / "classes.json").read_text())},
        )
        metadata_service.update_split_counts(DEST_NAME, split_counts)
        metadata_service.record_history_event(DEST_NAME, {
            "event": "converted_from_sam3_export",
            "source": str(SOURCE),
            "images": sum(split_counts.values()),
            "splits": split_counts,
            "classes": {str(k): v for k, v in classes.items()},
            "dropped_classes": {str(k): v for k, v in dropped.items()} or None,
            "note": "YOLO-seg polygons converted to detection boxes; empty classes dropped",
        })
        from app.services import dataset_service
        dataset_service.refresh_cached_summary(DEST_NAME)

    print("\nclasses written:")
    for cid, name in sorted(classes.items()):
        print(f"  {cid} {name:<10s} {per_class[cid]:6d} instances")
    if dropped:
        print("dropped source classes:")
        for cid, n in sorted(dropped.items()):
            print(f"  {cid} {n} instances")
    print(f"\nimages : {split_counts['train']} train + {split_counts['valid']} valid")
    print(f"empty  : {empty_labels} images with no instances (true negatives)")
    if bad_lines:
        print(f"skipped: {bad_lines} unparseable/degenerate label lines")
    if not args.dry_run:
        print(f"\nwrote {dest}")


if __name__ == "__main__":
    main()
