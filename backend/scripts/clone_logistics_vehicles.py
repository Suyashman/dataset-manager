#!/usr/bin/env python
"""Build Logistics_Vehicles: a subsample of the Logistics dataset (94,724 images, 5.1 GB).

    python backend/scripts/clone_logistics_vehicles.py [--dry-run]

Logistics is a Roboflow Universe benchmark (20 classes: barcode, car, cardboard box, fire,
forklift, freight container, gloves, helmet, ladder, license plate, person, qr code, road sign,
safety vest, smoke, traffic cone, traffic light, truck, van, wood pallet) that is 67% images with
none of car/forklift/truck/van. This keeps every image that has at least one of those four, plus a
20% random sample of the rest per split (so train/valid/test proportions stay intact), rather than
keeping all 94,724 images or dropping negatives to near-zero.

This is a CLONE, not a remap: every kept image's label file is copied byte-for-byte, all 20
original classes and ids untouched. Unlike the FACTORY_PPE_* work, there is no class unification
happening here -- one source, one vocabulary, just fewer images.

Long paths: Roboflow's auto-generated filenames (original name + '_jpg.rf.<32-char-hash>') combine
with this project's path depth to exceed Windows' 260-character MAX_PATH on a meaningful fraction
of files. Every filesystem call here goes through `longpath()`, which prepends the `\\\\?\\`
extended-length prefix, rather than relying on OS-level long-path support being enabled.
"""
import argparse
import os
import random
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import DATASETS_DIR
from app.services import metadata_service
from app.utils.yaml_io import load_data_yaml, save_data_yaml

SOURCE = DATASETS_DIR / "Logistics"
DEST_NAME = "Logistics_Vehicles"
WANTED = {1, 4, 17, 18}  # car, forklift, truck, van
NEG_FRACTION = 0.20
SEED = 0


def longpath(p: Path) -> str:
    """Bypass Windows' 260-char MAX_PATH via the \\\\?\\ extended-length prefix."""
    s = str(p.resolve())
    return s if s.startswith("\\\\?\\") else "\\\\?\\" + s


def link_or_copy(src: Path, dst: Path) -> None:
    src_lp, dst_lp = longpath(src), longpath(dst)
    if os.path.exists(dst_lp):
        return
    try:
        os.link(src_lp, dst_lp)
    except OSError:
        shutil.copy2(src_lp, dst_lp)


def classify_split(split: str) -> tuple[list[str], list[str]]:
    """One pass over a split's labels. Returns (positive_stems, negative_stems)."""
    lbl_dir = SOURCE / split / "labels"
    pos, neg = [], []
    for name in os.listdir(lbl_dir):
        if not name.endswith(".txt"):
            continue
        classes_here = set()
        with open(longpath(lbl_dir / name), "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    classes_here.add(int(line.split()[0]))
                except ValueError:
                    continue
        (pos if classes_here & WANTED else neg).append(name[:-4])  # strip .txt
    return pos, neg


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not (SOURCE / "data.yaml").exists():
        sys.exit(f"source not found: {SOURCE}")

    classes = load_data_yaml(SOURCE / "data.yaml")["classes"]  # {id: name}, all 20, untouched
    dest = DATASETS_DIR / DEST_NAME
    rng = random.Random(SEED)

    total_counts = {"train": 0, "valid": 0, "test": 0}
    t0 = time.perf_counter()

    for split in ("train", "valid", "test"):
        img_dir = SOURCE / split / "images"
        if not img_dir.exists():
            continue
        print(f"[{split}] scanning labels...")
        pos, neg = classify_split(split)
        n_keep_neg = round(len(neg) * NEG_FRACTION)
        kept_neg = rng.sample(neg, n_keep_neg) if n_keep_neg < len(neg) else neg
        keep_stems = pos + kept_neg
        print(f"[{split}] positive={len(pos)} negative_available={len(neg)} "
              f"negative_kept={len(kept_neg)} total_kept={len(keep_stems)}")
        total_counts[split] = len(keep_stems)

        if args.dry_run:
            continue

        (dest / split / "images").mkdir(parents=True, exist_ok=True)
        (dest / split / "labels").mkdir(parents=True, exist_ok=True)
        lbl_dir = SOURCE / split / "labels"
        for i, stem in enumerate(keep_stems, 1):
            img_src = img_dir / f"{stem}.jpg"
            lbl_src = lbl_dir / f"{stem}.txt"
            link_or_copy(img_src, dest / split / "images" / f"{stem}.jpg")
            link_or_copy(lbl_src, dest / split / "labels" / f"{stem}.txt")
            if i % 5000 == 0:
                print(f"[{split}] linked {i}/{len(keep_stems)}")

    print(f"\ntotal kept: {total_counts}  (sum={sum(total_counts.values())})")
    print(f"elapsed: {time.perf_counter()-t0:.1f}s")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    save_data_yaml(dest / "data.yaml", classes)
    metadata_service.update_class_mapping(
        DEST_NAME, classes,
        {"source": "Logistics", "note": "unchanged 20-class vocabulary, straight clone"})
    metadata_service.update_split_counts(DEST_NAME, total_counts)
    metadata_service.record_history_event(DEST_NAME, {
        "event": "cloned_subsample",
        "source": "Logistics",
        "wanted_classes": {str(k): classes[k] for k in WANTED},
        "negative_fraction_kept": NEG_FRACTION,
        "seed": SEED,
        "split_counts": total_counts,
        "note": "every image with car/forklift/truck/van kept; negatives are a random "
                f"{NEG_FRACTION:.0%} sample per split, seed={SEED}. Labels copied byte-for-byte, "
                "no class remapping -- all 20 original classes intact.",
    })
    from app.services import dataset_service
    dataset_service.refresh_cached_summary(DEST_NAME)
    print(f"\nwrote {dest}")


if __name__ == "__main__":
    main()
