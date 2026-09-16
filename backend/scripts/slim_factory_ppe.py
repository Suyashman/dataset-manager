#!/usr/bin/env python
"""Build a smaller, better-balanced dataset out of FACTORY_PPE_YOLO.

    python backend/scripts/slim_factory_ppe.py [--target 3500] [--neg-pct 10] [--dry-run]

The full set is 11,086 images for a two-class problem, and 34.7% of it is background with no
labels at all. That ratio teaches the model mostly "nothing here". This samples it down while
protecting the things that are actually scarce.

Three ideas do the work:

1. **Hardhat is the bottleneck.** person has 19,589 instances across 7,168 images; hardhat has
   6,699 across only 3,569. So hardhat-bearing images are taken first and person-only images are
   what gets cut, rather than trimming uniformly and starving the scarcer class.

2. **Spread beats volume.** Every image is bucketed by (camera, time-of-day) and the sampler
   round-robins across those buckets, so a slice of 3,500 still touches all 40 cameras and every
   part of the day instead of over-representing whichever camera happened to capture most.

3. **Backgrounds are capped, not removed.** Empty frames still teach the model that an empty gantry
   is not a person, so they are kept at roughly the ~10% Ultralytics suggests rather than the 34.7%
   that is there now.

The train/valid split is inherited image-by-image, never recomputed: the cameras are split-locked
(32 train-only, 8 valid-only) precisely so near-duplicate frames from one fixed camera cannot
appear on both sides. Re-splitting would leak them and make the validation score fiction.
"""
import argparse
import collections
import random
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import DATASETS_DIR
from app.services import metadata_service
from app.utils.yaml_io import save_data_yaml

SOURCE_NAME = "FACTORY_PPE_2_YOLO"
DEST_NAME = "FACTORY_PPE_3_SLIM"
CLASSES = {0: "person", 1: "hardhat"}

# Coarse enough that a stratum holds several frames, fine enough to separate daylight from night.
TIME_BUCKETS = [(0, 6, "night"), (6, 12, "morning"), (12, 18, "afternoon"), (18, 24, "evening")]


def time_bucket(hour: int) -> str:
    for lo, hi, name in TIME_BUCKETS:
        if lo <= hour < hi:
            return name
    return "unknown"


def scan(src: Path):
    """One record per image: split, camera, day, time bucket, and what is labelled in it."""
    out = []
    for split in ("train", "valid"):
        for lbl in (src / split / "labels").iterdir():
            if lbl.suffix != ".txt":
                continue
            stem = lbl.stem
            cam = stem.split("__")[0]
            m = re.search(r"_(\d{8})_(\d{6})_", stem)
            day, hour = (m.group(1), int(m.group(2)[:2])) if m else ("unknown", 0)
            lines = [l for l in lbl.read_text(encoding="utf-8").splitlines() if l.strip()]
            n_hat = sum(1 for l in lines if l.startswith("1 "))
            n_person = sum(1 for l in lines if l.startswith("0 "))
            out.append({
                "stem": stem, "split": split, "cam": cam, "day": day,
                "tb": time_bucket(hour), "hour": hour,
                "n_hat": n_hat, "n_person": n_person, "n": n_hat + n_person,
            })
    return out


def round_robin(pool: dict[tuple, list], quota: int) -> list:
    """Take one image from each stratum in turn until quota is met.

    Round-robin rather than proportional sampling is what keeps a small slice broad: a camera
    with 17 frames contributes on the same footing as one with 683, so nothing drops out of the
    dataset just for being a quiet corner of the factory.
    """
    picked = []
    keys = sorted(pool)
    idx = {k: 0 for k in keys}
    while len(picked) < quota:
        progressed = False
        for k in keys:
            if len(picked) >= quota:
                break
            i = idx[k]
            if i < len(pool[k]):
                picked.append(pool[k][i])
                idx[k] = i + 1
                progressed = True
        if not progressed:
            break  # every stratum exhausted
    return picked


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=3500, help="total images to keep")
    ap.add_argument("--neg-pct", type=float, default=10.0, help="percent that may be background")
    ap.add_argument("--hat-share", type=float, default=65.0,
                    help="percent of the labelled images that must contain a hardhat. The rest are "
                         "person-only frames, which are the scenes where NOBODY is wearing a "
                         "helmet -- the violation case, so they cannot be squeezed out entirely.")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    src = DATASETS_DIR / SOURCE_NAME
    dest = DATASETS_DIR / DEST_NAME
    if not (src / "data.yaml").exists():
        sys.exit(f"source dataset not found: {src}")

    rng = random.Random(args.seed)
    rows = scan(src)
    print(f"source: {len(rows)} images, {sum(1 for r in rows if r['n'] == 0)} background")

    # Keep the original train/valid proportion; each side is sampled on its own so the
    # split-locked cameras stay exactly where they were.
    by_split = collections.Counter(r["split"] for r in rows)
    frac_valid = by_split["valid"] / len(rows)
    targets = {
        "valid": round(args.target * frac_valid),
        "train": args.target - round(args.target * frac_valid),
    }

    chosen = []
    for split in ("train", "valid"):
        want = targets[split]
        want_neg = round(want * args.neg_pct / 100)
        want_pos = want - want_neg
        srows = [r for r in rows if r["split"] == split]

        hats = collections.defaultdict(list)
        persons = collections.defaultdict(list)
        negs = collections.defaultdict(list)
        for r in srows:
            key = (r["cam"], r["tb"])
            if r["n_hat"]:
                hats[key].append(r)
            elif r["n_person"]:
                persons[key].append(r)
            else:
                negs[key].append(r)

        # Inside a stratum: richest hardhat frames first (scarce class), people shuffled for
        # variety, backgrounds shuffled so we do not take a run of consecutive near-identical frames.
        for k in hats:
            hats[k].sort(key=lambda r: (-r["n_hat"], -r["n_person"]))
        for d in (persons, negs):
            for k in d:
                rng.shuffle(d[k])

        # Explicit shares, not "hardhat first and person-only gets the leftovers". With a leftover
        # rule the hardhat quota eats every positive slot and the set ends up containing no frame
        # where nobody wears a helmet -- which is the exact situation the model exists to flag.
        want_hat = round(want_pos * args.hat_share / 100)
        picked_hat = round_robin(hats, want_hat)
        picked_person = round_robin(persons, want_pos - len(picked_hat))
        # Whatever a thin category could not fill, hand back to the other one rather than
        # shrinking the dataset below target.
        if len(picked_hat) + len(picked_person) < want_pos:
            shortfall = want_pos - len(picked_hat) - len(picked_person)
            taken = {r["stem"] for r in picked_hat + picked_person}
            spare = {k: [r for r in v if r["stem"] not in taken] for k, v in
                     (hats if len(picked_person) >= want_pos - want_hat else persons).items()}
            picked_hat += round_robin(spare, shortfall)
        picked_neg = round_robin(negs, want_neg)
        chosen += picked_hat + picked_person + picked_neg
        print(f"  {split}: {len(picked_hat)} with hardhat + {len(picked_person)} person-only "
              f"+ {len(picked_neg)} background = {len(picked_hat)+len(picked_person)+len(picked_neg)}")

    # --- report the shape of what was chosen ---------------------------------
    cams = collections.Counter(r["cam"] for r in chosen)
    days = collections.Counter(r["day"] for r in chosen)
    tbs = collections.Counter(r["tb"] for r in chosen)
    n_hat = sum(r["n_hat"] for r in chosen)
    n_person = sum(r["n_person"] for r in chosen)
    n_empty = sum(1 for r in chosen if r["n"] == 0)
    print(f"\nkept {len(chosen)} images from {len(cams)} cameras (source had 40)")
    print(f"  instances : {n_person} person, {n_hat} hardhat")
    print(f"  background: {n_empty} ({n_empty/len(chosen)*100:.1f}%)")
    print(f"  days      : {dict(sorted(days.items()))}")
    print(f"  time      : {dict(tbs)}")
    least = cams.most_common()[-3:]
    print(f"  thinnest cameras: {', '.join(f'{c.split('_')[0]}={n}' for c, n in least)}")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    import os
    import shutil

    def link_or_copy(a: Path, b: Path):
        if b.exists():
            return
        try:
            os.link(a, b)
        except OSError:
            shutil.copy2(a, b)

    for split in ("train", "valid", "test"):
        (dest / split / "images").mkdir(parents=True, exist_ok=True)
        (dest / split / "labels").mkdir(parents=True, exist_ok=True)

    counts = {"train": 0, "valid": 0, "test": 0}
    for r in chosen:
        s = r["split"]
        link_or_copy(src / s / "images" / f"{r['stem']}.jpg", dest / s / "images" / f"{r['stem']}.jpg")
        shutil.copyfile(src / s / "labels" / f"{r['stem']}.txt", dest / s / "labels" / f"{r['stem']}.txt")
        counts[s] += 1

    save_data_yaml(dest / "data.yaml", CLASSES)
    metadata_service.update_class_mapping(
        DEST_NAME, CLASSES, {"dataset": SOURCE_NAME, "original_mapping": {"0": "person", "1": "hardhat"}})
    metadata_service.update_split_counts(DEST_NAME, counts)
    metadata_service.record_history_event(DEST_NAME, {
        "event": "stratified_subsample",
        "source": SOURCE_NAME,
        "kept": len(chosen), "from": len(rows),
        "splits": counts,
        "instances": {"person": n_person, "hardhat": n_hat},
        "background_pct": round(n_empty / len(chosen) * 100, 1),
        "strategy": "round-robin over (camera, time-of-day); hardhat-bearing frames first; "
                    "background capped; train/valid inherited to keep cameras split-locked",
        "seed": args.seed,
    })
    from app.services import dataset_service
    dataset_service.refresh_cached_summary(DEST_NAME)
    print(f"\nwrote {dest}  ({counts['train']} train / {counts['valid']} valid)")


if __name__ == "__main__":
    main()
