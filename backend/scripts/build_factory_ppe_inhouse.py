#!/usr/bin/env python
"""Build FACTORY_PPE_5_INHOUSE from FACTORY_PPE_3_SLIM + factory_ppe_master.

    python backend/scripts/build_factory_ppe_inhouse.py [--dry-run]

Both sources are in-house camera captures (unlike ppe_all_combined, which mixes in public
data) -- hence the name. Two different jobs per source:

**FACTORY_PPE_3_SLIM's own classes are LOCKED: copied through byte-for-byte, same ids, same names,
nothing added, nothing removed.** SLIM currently declares person(0), hardhat(1), goggles(2),
welding shield(3) -- checked against SLIM_LOCKED_CLASSES below at runtime, and the script refuses
to run if SLIM has changed since this was written, rather than silently mislabeling again the way
an earlier version of this script did (it assumed SLIM's ids always matched this dataset's and
hardlinked its labels through unvalidated; when SLIM grew two classes after being first built,
that silently relabeled SLIM's goggles/welding-shield lines as whatever this dataset's ids 2/3
happened to mean at the time).

**factory_ppe_master** (11 classes: boots, ear_protection, eyewear, gloves, safetyhelmet, mask,
person, reflective, harness, welding_helmet, No_Gloves) contributes only what SLIM does not
already have, mapped by concept onto SLIM's locked vocabulary, plus one genuinely new class:

    person       -> person        (SLIM's id 0)
    safetyhelmet -> hardhat       (SLIM's id 1)
    reflective   -> safety_vest   (new id 4 -- SLIM has no vest class at all)
    everything else                    -- dropped as a LABEL LINE, never as a whole image

master's own 'welding_helmet' is NOT merged into SLIM's 'welding shield' for the general
population: FINDINGS.md already flagged that concept as unreliable on this factory's own cameras
('conflated with cloth face coverings'). The one exception is the 'weld' filename prefix -- 23
images deliberately annotated for welding content -- where welding_helmet IS mapped in, since
that specific concern doesn't apply to a hand-curated batch.

Unlike FACTORY_PPE_4_COMBINED's filter (which drops a whole image on an unwanted class), no
image is ever excluded here. An image whose only original labels fall in the dropped set keeps
its other content but gets no boxes for this merge -- the same true-negative pattern already
used throughout this project (an empty .txt, never a missing one, so Ultralytics reads the frame
as a confirmed negative instead of skipping it).

Each source's own split assignment (train/valid/test) is kept as-is, for the same reason it was
kept for FACTORY_PPE_4_COMBINED: re-splitting risks leaking near-duplicate frames.
"""
import argparse
import os
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import DATASETS_DIR
from app.services import metadata_service
from app.utils.seg_to_box import seg_line_to_box_line
from app.utils.yaml_io import load_data_yaml, save_data_yaml

SLIM = DATASETS_DIR / "FACTORY_PPE_3_SLIM"
MASTER = DATASETS_DIR / "factory_ppe_master"
DEST_NAME = "FACTORY_PPE_5_INHOUSE"

# SLIM's classes, locked. If SLIM's own data.yaml ever stops matching this exactly, the script
# stops instead of guessing -- this is the guard that was missing the first time.
SLIM_LOCKED_CLASSES = {0: "person", 1: "hardhat", 2: "goggles", 3: "welding shield"}
CLASSES = {**SLIM_LOCKED_CLASSES, 4: "safety_vest"}

# factory_ppe_master's own ids -> target id. Anything absent from this dict is dropped as a line.
MASTER_MAP = {6: 0, 4: 1, 7: 4}  # person->0, safetyhelmet->1, reflective->4 (safety_vest, new)


def link_or_copy(src: Path, dst: Path) -> None:
    if dst.exists():
        return
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def copy_slim(dest: Path, dry_run: bool) -> tuple[dict, dict]:
    """Locked passthrough: SLIM's images and labels, byte-for-byte, nothing remapped.

    Refuses to run if SLIM's own data.yaml no longer matches SLIM_LOCKED_CLASSES exactly -- that
    mismatch is exactly what silently corrupted this dataset once already.
    """
    live = load_data_yaml(SLIM / "data.yaml")["classes"]
    if live != SLIM_LOCKED_CLASSES:
        sys.exit(
            f"SLIM's classes have changed since this script was locked to them.\n"
            f"  locked (expected): {SLIM_LOCKED_CLASSES}\n"
            f"  found just now   : {live}\n"
            f"Update SLIM_LOCKED_CLASSES (and MASTER_MAP's target ids) to match before re-running -- "
            f"do not proceed on a guess, that is exactly how this dataset got corrupted before."
        )

    counts = {"train": 0, "valid": 0, "test": 0}
    per_class = {cid: 0 for cid in CLASSES}  # includes ids SLIM doesn't have (4=safety_vest)
    for split in ("train", "valid", "test"):
        img_dir, lbl_dir = SLIM / split / "images", SLIM / split / "labels"
        if not img_dir.exists():
            continue
        if not dry_run:
            (dest / split / "images").mkdir(parents=True, exist_ok=True)
            (dest / split / "labels").mkdir(parents=True, exist_ok=True)
        for img in img_dir.iterdir():
            lbl = lbl_dir / f"{img.stem}.txt"
            for l in (lbl.read_text(encoding="utf-8").splitlines() if lbl.exists() else []):
                if l.strip():
                    per_class[int(l.split()[0])] += 1
            if not dry_run:
                link_or_copy(img, dest / split / "images" / img.name)
                link_or_copy(lbl, dest / split / "labels" / f"{img.stem}.txt")
            counts[split] += 1
    return counts, per_class


def remap_master(dest: Path, dry_run: bool) -> tuple[dict, dict, int, int]:
    """Returns (image_counts_per_split, per_class_instances, images_now_empty, degenerate_dropped)."""
    counts = {"train": 0, "valid": 0, "test": 0}
    per_class = {v: 0 for v in CLASSES}
    now_empty = 0
    degenerate = 0

    for split in ("train", "valid", "test"):
        img_dir, lbl_dir = MASTER / split / "images", MASTER / split / "labels"
        if not img_dir.exists():
            continue
        if not dry_run:
            (dest / split / "images").mkdir(parents=True, exist_ok=True)
            (dest / split / "labels").mkdir(parents=True, exist_ok=True)

        for img in img_dir.iterdir():
            lbl = lbl_dir / f"{img.stem}.txt"
            lines = [l for l in lbl.read_text(encoding="utf-8", errors="ignore").splitlines() if l.strip()] \
                if lbl.exists() else []

            # welding_helmet(9) is trusted only for the 'weld' prefix -- the 23 images
            # deliberately annotated for welding content. FINDINGS.md flagged this class as
            # unreliable across the general factory_ppe_master population ('conflated with
            # cloth face coverings'), which doesn't apply to this specific curated batch.
            class_map = MASTER_MAP
            if img.stem.startswith("weld"):
                class_map = {**MASTER_MAP, 9: 3}  # welding_helmet -> welding shield (SLIM's id 3)

            out_lines = []
            for raw in lines:
                t = raw.split()
                try:
                    old_cls = int(float(t[0]))
                except (ValueError, IndexError):
                    continue
                if old_cls not in class_map:
                    continue  # not in the target vocabulary -- drop the line, keep the image
                fixed = seg_line_to_box_line(f"{old_cls} {' '.join(t[1:])}")
                if fixed is None:
                    degenerate += 1
                    continue
                new_cls = class_map[old_cls]
                out_lines.append(f"{new_cls} {fixed.split(' ', 1)[1]}")
                per_class[new_cls] += 1

            if not out_lines:
                now_empty += 1

            if not dry_run:
                link_or_copy(img, dest / split / "images" / img.name)
                # Every image is written, even with zero lines: this is the true-negative
                # pattern, not a dropped image -- the whole point of this merge is that no
                # image gets excluded, per the explicit instruction for this dataset.
                (dest / split / "labels" / f"{img.stem}.txt").write_text(
                    "\n".join(out_lines) + ("\n" if out_lines else ""), encoding="utf-8")
            counts[split] += 1

    return counts, per_class, now_empty, degenerate


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not (SLIM / "data.yaml").exists():
        sys.exit(f"source not found: {SLIM}")
    if not (MASTER / "data.yaml").exists():
        sys.exit(f"source not found: {MASTER}")

    dest = DATASETS_DIR / DEST_NAME
    slim_counts, slim_per_class = copy_slim(dest, args.dry_run)
    master_counts, master_per_class, now_empty, degenerate = remap_master(dest, args.dry_run)

    slim_named = {CLASSES[k]: v for k, v in slim_per_class.items()}
    master_named = {CLASSES[k]: v for k, v in master_per_class.items()}
    combined_named = {CLASSES[k]: slim_per_class[k] + master_per_class[k] for k in CLASSES}

    total = {s: slim_counts[s] + master_counts[s] for s in ("train", "valid", "test")}
    print(f"FACTORY_PPE_3_SLIM contributed : {slim_counts}  (locked passthrough)")
    print(f"  instances (as-is)            : {slim_named}")
    print(f"factory_ppe_master contributed : {master_counts}  (all images kept, none dropped)")
    print(f"  remapped instances           : {master_named}")
    print(f"  now-empty labels (true neg.) : {now_empty} of {sum(master_counts.values())}")
    print(f"  degenerate lines dropped     : {degenerate}")
    print(f"combined totals                : {total}  (sum={sum(total.values())})")
    print(f"expected final per-class totals: {combined_named}"
          "  <- cross-check this against an exhaustive scan of the written files")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    master_classes = load_data_yaml(MASTER / "data.yaml")["classes"]
    save_data_yaml(dest / "data.yaml", CLASSES)
    metadata_service.update_class_mapping(
        DEST_NAME, CLASSES,
        {"sources": ["FACTORY_PPE_3_SLIM", "factory_ppe_master"],
         "slim_classes_locked": SLIM_LOCKED_CLASSES,
         "factory_ppe_master_original_mapping": {str(k): v for k, v in master_classes.items()},
         "factory_ppe_master_classes_kept": {str(k): v for k, v in MASTER_MAP.items()},
         "factory_ppe_master_classes_dropped_as_lines_only": sorted(
             set(master_classes) - set(MASTER_MAP))})
    metadata_service.update_split_counts(DEST_NAME, total)
    metadata_service.record_history_event(DEST_NAME, {
        "event": "built_inhouse_merge",
        "slim_source": "FACTORY_PPE_3_SLIM",
        "slim_images": slim_counts,
        "slim_instances_contributed": slim_named,
        "master_source": "factory_ppe_master",
        "master_images_kept": master_counts,
        "master_images_now_empty": now_empty,
        "master_lines_dropped_degenerate": degenerate,
        "master_instances_contributed": {CLASSES[k]: v for k, v in master_per_class.items()},
        "classes": {str(k): v for k, v in CLASSES.items()},
        "note": "no image ever dropped; unmapped classes (boots, ear_protection, eyewear, "
                "gloves, mask, harness, welding_helmet, No_Gloves) removed as label lines only",
    })
    from app.services import dataset_service
    dataset_service.refresh_cached_summary(DEST_NAME)
    print(f"\nwrote {dest}")


if __name__ == "__main__":
    main()
