#!/usr/bin/env python
"""Thin a near-duplicate video-frame burst out of FACTORY_PPE_4_INHOUSE_PUBLIC.

    python backend/scripts/prune_pm_video_burst.py [--keep 20] [--dry-run]

PM002003.jpg..PM002306.jpg (train split) are a burst of ~292 consecutive frames from one fixed
checkpoint camera: several different people cycling through the same repetitive arm-signaling
gesture, same background throughout. Frame-to-frame the pose barely changes, so keeping all 292
would let one camera-burst dominate a dataset otherwise built from many distinct cameras/scenes.

Kept frames are evenly spaced BY POSITION across the present files (not by raw PM number, since
12 numbers in the range are already absent -- excluded by the FACTORY_PPE_4 build for containing
eyewear/glove/mask). Even spacing was chosen over hand-picking because a spot check every 10th
frame already showed it naturally samples the outfit/pose variation that exists in the burst
(a stretch with no helmet around PM002113, a different helmet color near PM002293) without extra
curation. Everything outside this specific PM-number range is untouched.

Deletes both the image and its label; nothing here is hardlinked from any other dataset's own
copy of these bytes (ppe_all_combined keeps its full, unpruned copy).
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import DATASETS_DIR
from app.services import metadata_service

DEST_NAME = "FACTORY_PPE_4_INHOUSE_PUBLIC"
SPLIT = "train"
LO, HI = 2003, 2306


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=20)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    d = DATASETS_DIR / DEST_NAME / SPLIT
    img_dir, lbl_dir = d / "images", d / "labels"

    present = sorted(
        (p for p in img_dir.iterdir() if p.stem.startswith("PM") and p.stem[2:].isdigit()
         and LO <= int(p.stem[2:]) <= HI),
        key=lambda p: int(p.stem[2:]),
    )
    n = len(present)
    if n <= args.keep:
        sys.exit(f"only {n} files present in range, nothing to prune at --keep {args.keep}")

    # Evenly spaced indices across the present list, endpoints included.
    keep_idx = {round(i * (n - 1) / (args.keep - 1)) for i in range(args.keep)}
    keep = {present[i] for i in keep_idx}
    drop = [p for p in present if p not in keep]

    print(f"range PM{LO:06d}-PM{HI:06d}: {n} present, keeping {len(keep)}, dropping {len(drop)}")
    print("kept:", ", ".join(p.stem for p in sorted(keep, key=lambda p: int(p.stem[2:]))))

    removed_instances = 0
    for img in drop:
        lbl = lbl_dir / f"{img.stem}.txt"
        if lbl.exists():
            removed_instances += sum(1 for l in lbl.read_text().splitlines() if l.strip())
        if not args.dry_run:
            img.unlink()
            lbl.unlink(missing_ok=True)

    print(f"label instances removed: {removed_instances}")

    if args.dry_run:
        print("\n--dry-run: nothing deleted")
        return

    metadata_service.update_split_counts(DEST_NAME, {SPLIT: -len(drop)})
    metadata_service.record_history_event(DEST_NAME, {
        "event": "pruned_video_burst",
        "split": SPLIT,
        "range": f"PM{LO:06d}-PM{HI:06d}",
        "present_before": n,
        "kept": len(keep),
        "dropped": len(drop),
        "label_instances_removed": removed_instances,
        "note": "near-duplicate frames from one fixed checkpoint camera; evenly spaced by "
                "position across the present files, endpoints included",
    })
    from app.services import dataset_service
    dataset_service.refresh_cached_summary(DEST_NAME)
    print(f"\ndone: removed {len(drop)} images from {DEST_NAME}/{SPLIT}")


if __name__ == "__main__":
    main()
