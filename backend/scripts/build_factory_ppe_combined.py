#!/usr/bin/env python
"""Build FACTORY_PPE_4_INHOUSE_PUBLIC from FACTORY_PPE_3_SLIM + a filtered slice of ppe_all_combined.

    python backend/scripts/build_factory_ppe_combined.py [--dry-run]

**FACTORY_PPE_3_SLIM's own classes are LOCKED: copied through byte-for-byte, same ids, same names,
nothing added, nothing removed.** SLIM currently declares person(0), hardhat(1), goggles(2),
welding shield(3) -- checked against SLIM_LOCKED_CLASSES below at runtime, and the script refuses
to run if SLIM has changed since this was written, rather than silently mislabeling again the way
an earlier version of this script did (it assumed SLIM's ids always matched this dataset's and
hardlinked its labels through unvalidated; when SLIM grew two classes after being first built, that
silently relabeled SLIM's goggles as this dataset's welding_shield and its welding shield as
safety_vest).

**ppe_all_combined** (person, safety_helmet, welding_shield, eyewear, safety_vest, glove, mask,
no_eyewear, no_glove, boots, no_boots) is mapped BY CONCEPT onto SLIM's locked vocabulary, with one
genuinely new class appended for what SLIM has no equivalent of:

    person         -> person          (SLIM's id 0)
    safety_helmet  -> hardhat         (SLIM's id 1)   -- same PPE item, different name
    welding_shield -> welding shield  (SLIM's id 3)   -- exact concept match
    safety_vest    -> safety_vest     (new id 4)       -- SLIM has no vest class at all

- An image is DROPPED ENTIRELY if it has ANY instance of eyewear, glove, or mask -- not just
  those label lines, the whole image. This is about ppe_all_combined's OWN eyewear class
  specifically, which spans too many physical types to be trustworthy (unlike SLIM's own
  'goggles', which is locked and kept regardless) -- and a partly-excluded image would still
  teach the model to expect eyewear/gloves/masks it is never asked to detect.
- no_eyewear / no_glove / boots / no_boots do not trigger exclusion -- they are absence labels or
  an unrequested class, not the thing being excluded -- but their label LINES are dropped from any
  image that does survive, since they are not part of the target vocabulary.

Each source's own split assignment (train/valid/test) is kept as-is. Re-splitting either source
would risk leaking near-duplicate frames across train/valid, which is exactly what both sources
were built to avoid in the first place.
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
PUBLIC = DATASETS_DIR / "ppe_all_combined"
DEST_NAME = "FACTORY_PPE_4_INHOUSE_PUBLIC"

# SLIM's classes, locked. If SLIM's own data.yaml ever stops matching this exactly, the script
# stops instead of guessing -- this is the guard that was missing the first time.
SLIM_LOCKED_CLASSES = {0: "person", 1: "hardhat", 2: "goggles", 3: "welding shield"}
CLASSES = {**SLIM_LOCKED_CLASSES, 4: "safety_vest"}

# ppe_all_combined's own ids -> target id: person->0, safety_helmet->1, welding_shield->3 (SLIM's
# own welding-shield id), safety_vest->4 (the one new class).
PUBLIC_KEEP = {0: 0, 1: 1, 2: 3, 4: 4}
# Presence of ANY of these anywhere in the image drops the whole image.
PUBLIC_EXCLUDE_IMAGE = {3, 5, 6}  # eyewear, glove, mask
# Everything else (no_eyewear=7, no_glove=8, boots=9, no_boots=10) is dropped as a line only.
SLIM_NAME_TO_TARGET = {"person": 0, "hardhat": 1, "welding_shield": 2}


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
            f"Update SLIM_LOCKED_CLASSES (and PUBLIC_KEEP's target ids) to match before re-running -- "
            f"do not proceed on a guess, that is exactly how this dataset got corrupted before."
        )

    counts = {"train": 0, "valid": 0, "test": 0}
    per_class = {cid: 0 for cid in CLASSES}  # includes ids SLIM doesn't have (e.g. 4=safety_vest)
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


def filter_public(dest: Path, dry_run: bool) -> tuple[dict, dict, int]:
    counts = {"train": 0, "valid": 0, "test": 0}
    dropped_excluded = dropped_irrelevant = dropped_degenerate = 0
    per_class = {v: 0 for v in CLASSES}

    for split in ("train", "valid", "test"):
        img_dir, lbl_dir = PUBLIC / split / "images", PUBLIC / split / "labels"
        if not img_dir.exists():
            continue
        if not dry_run:
            (dest / split / "images").mkdir(parents=True, exist_ok=True)
            (dest / split / "labels").mkdir(parents=True, exist_ok=True)

        for lbl in lbl_dir.iterdir():
            lines = [l for l in lbl.read_text(encoding="utf-8", errors="ignore").splitlines() if l.strip()]
            parsed = []
            classes_here = set()
            for l in lines:
                t = l.split()
                try:
                    c = int(float(t[0]))
                except (ValueError, IndexError):
                    continue
                parsed.append((c, t[1:]))
                classes_here.add(c)

            if classes_here & PUBLIC_EXCLUDE_IMAGE:
                dropped_excluded += 1
                continue
            if not (classes_here & PUBLIC_KEEP.keys()):
                dropped_irrelevant += 1
                continue

            # Validate/reformat through the same guard the SAM3 import path uses, rather than
            # passing ppe_all_combined's coordinates through untouched: that source has its own
            # pre-existing zero-area lines (e.g. 'w 0.000000 h 0.000000', found by inspection),
            # and this catches those instead of quietly carrying them into a new dataset.
            out_lines = []
            for c, v in parsed:
                if c not in PUBLIC_KEEP:
                    continue
                fixed = seg_line_to_box_line(f"{c} {' '.join(v)}")
                if fixed is None:
                    dropped_degenerate += 1
                    continue
                new_cls = PUBLIC_KEEP[c]
                out_lines.append(f"{new_cls} {fixed.split(' ', 1)[1]}")
                per_class[new_cls] += 1

            if not out_lines:
                dropped_irrelevant += 1
                continue

            stem = lbl.stem
            img = next((img_dir / f"{stem}{ext}" for ext in (".jpg", ".jpeg", ".png")
                        if (img_dir / f"{stem}{ext}").exists()), None)
            if img is None:
                continue
            if not dry_run:
                link_or_copy(img, dest / split / "images" / img.name)
                (dest / split / "labels" / f"{stem}.txt").write_text(
                    "\n".join(out_lines) + "\n", encoding="utf-8")
            counts[split] += 1

    return counts, per_class, dropped_excluded, dropped_irrelevant, dropped_degenerate


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if not (SLIM / "data.yaml").exists():
        sys.exit(f"source not found: {SLIM}")
    if not (PUBLIC / "data.yaml").exists():
        sys.exit(f"source not found: {PUBLIC}")

    dest = DATASETS_DIR / DEST_NAME
    slim_counts, slim_per_class = copy_slim(dest, args.dry_run)
    pub_counts, pub_per_class, dropped_excl, dropped_irrel, dropped_degen = filter_public(dest, args.dry_run)

    slim_named = {CLASSES[k]: v for k, v in slim_per_class.items()}
    pub_named = {CLASSES[k]: v for k, v in pub_per_class.items()}
    combined_per_class = {k: slim_per_class[k] + pub_per_class[k] for k in CLASSES}
    combined_named = {CLASSES[k]: v for k, v in combined_per_class.items()}

    total = {s: slim_counts[s] + pub_counts[s] for s in ("train", "valid", "test")}
    print(f"FACTORY_PPE_3_SLIM contributed : {slim_counts}  (locked passthrough)")
    print(f"  instances (as-is)            : {slim_named}")
    print(f"ppe_all_combined contributed   : {pub_counts}")
    print(f"  instances (name-matched)     : {pub_named}")
    print(f"  dropped (eyewear/glove/mask) : {dropped_excl}")
    print(f"  dropped (no wanted class)    : {dropped_irrel}")
    print(f"  dropped degenerate box lines : {dropped_degen}")
    print(f"combined totals                : {total}  (sum={sum(total.values())})")
    print(f"expected final per-class totals: {combined_named}"
          "  <- cross-check this against an exhaustive scan of the written files")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    public_classes = load_data_yaml(PUBLIC / "data.yaml")["classes"]  # {id: name}, e.g. {3: "eyewear"}
    save_data_yaml(dest / "data.yaml", CLASSES)
    metadata_service.update_class_mapping(
        DEST_NAME, CLASSES,
        {"sources": ["FACTORY_PPE_3_SLIM", "ppe_all_combined"],
         "slim_classes_locked": SLIM_LOCKED_CLASSES,
         "ppe_all_combined_original_mapping": {str(k): v for k, v in public_classes.items()},
         "ppe_all_combined_classes_kept": {str(k): v for k, v in PUBLIC_KEEP.items()},
         "ppe_all_combined_classes_excluded_whole_image": sorted(PUBLIC_EXCLUDE_IMAGE)})
    metadata_service.update_split_counts(DEST_NAME, total)
    metadata_service.record_history_event(DEST_NAME, {
        "event": "built_from_two_sources",
        "slim_source": "FACTORY_PPE_3_SLIM",
        "slim_images": slim_counts,
        "slim_instances_contributed": slim_named,
        "public_source": "ppe_all_combined",
        "public_images_kept": pub_counts,
        "public_images_dropped_eyewear_glove_mask": dropped_excl,
        "public_images_dropped_no_wanted_class": dropped_irrel,
        "public_lines_dropped_degenerate": dropped_degen,
        "public_instances_contributed": pub_named,
        "classes": {str(k): v for k, v in CLASSES.items()},
        "note": "SLIM's own classes are LOCKED: copied through unchanged, byte-for-byte. "
                "eyewear/glove/mask exclusion from ppe_all_combined is whole-image; "
                "no_eyewear/no_glove/boots/no_boots lines dropped but did not block the image. "
                "REBUILD 2026-09-16: an earlier version of this script hardlinked SLIM's labels "
                "through unchanged, which mislabeled SLIM's goggles/welding-shield lines (added "
                "to SLIM after the first build) as this dataset's welding_shield/safety_vest.",
    })
    from app.services import dataset_service
    dataset_service.refresh_cached_summary(DEST_NAME)
    print(f"\nwrote {dest}")


if __name__ == "__main__":
    main()
