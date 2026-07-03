import random

import cv2
import numpy as np

from app.utils.label_utils import parse_label_file

# Boxes narrower/shorter than this fraction of the image after a geometric transform are
# dropped as noise (e.g. a box rotated almost entirely out of frame) rather than kept as a
# near-zero-area label that would only confuse training.
_MIN_BOX_FRACTION = 0.01


def _write_labels(path, lines: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
        if lines:
            f.write("\n")


def _boxes_to_lines(boxes: list[dict]) -> list[str]:
    return [
        f"{b['class_id']} {b['x_center']:.6f} {b['y_center']:.6f} {b['width']:.6f} {b['height']:.6f}"
        for b in boxes
    ]


def apply_flip(img_path, label_path, out_img_path, out_label_path, params: dict) -> int:
    """Horizontal flip. Mirrors x_center; width/height/y_center are unaffected."""
    img = cv2.imread(str(img_path))
    flipped = cv2.flip(img, 1)
    cv2.imwrite(str(out_img_path), flipped)

    boxes = parse_label_file(label_path)
    for b in boxes:
        b["x_center"] = 1.0 - b["x_center"]
    _write_labels(out_label_path, _boxes_to_lines(boxes))
    return 0


def apply_rotate(img_path, label_path, out_img_path, out_label_path, params: dict) -> int:
    """Rotates the image in place (same canvas size, gray-filled corners) and rotates each
    box's 4 corners through the same matrix, re-deriving a tight axis-aligned box."""
    lo, hi = params.get("angle_range", (-15, 15))
    angle = random.uniform(lo, hi)

    img = cv2.imread(str(img_path))
    h, w = img.shape[:2]
    center = (w / 2, h / 2)
    matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
    rotated = cv2.warpAffine(img, matrix, (w, h), borderValue=(114, 114, 114))
    cv2.imwrite(str(out_img_path), rotated)

    boxes = parse_label_file(label_path)
    out_boxes = []
    dropped = 0
    for b in boxes:
        x1 = (b["x_center"] - b["width"] / 2) * w
        y1 = (b["y_center"] - b["height"] / 2) * h
        x2 = (b["x_center"] + b["width"] / 2) * w
        y2 = (b["y_center"] + b["height"] / 2) * h
        corners = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
        ones = np.ones((4, 1))
        transformed = (matrix @ np.hstack([corners, ones]).T).T

        nx1, ny1 = transformed[:, 0].min(), transformed[:, 1].min()
        nx2, ny2 = transformed[:, 0].max(), transformed[:, 1].max()
        nx1, nx2 = np.clip([nx1, nx2], 0, w)
        ny1, ny2 = np.clip([ny1, ny2], 0, h)

        box_w, box_h = nx2 - nx1, ny2 - ny1
        if box_w < w * _MIN_BOX_FRACTION or box_h < h * _MIN_BOX_FRACTION:
            dropped += 1
            continue

        out_boxes.append({
            "class_id": b["class_id"],
            "x_center": (nx1 + nx2) / 2 / w,
            "y_center": (ny1 + ny2) / 2 / h,
            "width": box_w / w,
            "height": box_h / h,
        })

    _write_labels(out_label_path, _boxes_to_lines(out_boxes))
    return dropped


def apply_hsv(img_path, label_path, out_img_path, out_label_path, params: dict) -> int:
    """Pixel-only jitter of hue/saturation/value. Boxes are copied through unchanged."""
    h_gain = params.get("hsv_h", 0.015)
    s_gain = params.get("hsv_s", 0.7)
    v_gain = params.get("hsv_v", 0.4)

    img = cv2.imread(str(img_path))
    r = np.random.uniform(-1, 1, 3) * [h_gain, s_gain, v_gain] + 1
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[..., 0] = (hsv[..., 0] * r[0]) % 180
    hsv[..., 1] = np.clip(hsv[..., 1] * r[1], 0, 255)
    hsv[..., 2] = np.clip(hsv[..., 2] * r[2], 0, 255)
    out = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    cv2.imwrite(str(out_img_path), out)

    boxes = parse_label_file(label_path)
    _write_labels(out_label_path, _boxes_to_lines(boxes))
    return 0


def apply_blur(img_path, label_path, out_img_path, out_label_path, params: dict) -> int:
    """Gaussian blur. Boxes are copied through unchanged."""
    lo, hi = params.get("blur_kernel_range", (3, 7))
    lo, hi = int(lo) | 1, int(hi) | 1  # force odd
    kernel = random.randrange(lo, hi + 1, 2) if hi > lo else lo

    img = cv2.imread(str(img_path))
    blurred = cv2.GaussianBlur(img, (kernel, kernel), 0)
    cv2.imwrite(str(out_img_path), blurred)

    boxes = parse_label_file(label_path)
    _write_labels(out_label_path, _boxes_to_lines(boxes))
    return 0


def apply_noise(img_path, label_path, out_img_path, out_label_path, params: dict) -> int:
    """Additive Gaussian pixel noise. Boxes are copied through unchanged."""
    lo, hi = params.get("noise_sigma_range", (5, 25))
    sigma = random.uniform(lo, hi)

    img = cv2.imread(str(img_path)).astype(np.float32)
    noise = np.random.normal(0, sigma, img.shape)
    noisy = np.clip(img + noise, 0, 255).astype(np.uint8)
    cv2.imwrite(str(out_img_path), noisy)

    boxes = parse_label_file(label_path)
    _write_labels(out_label_path, _boxes_to_lines(boxes))
    return 0


TECHNIQUES = {
    "flip": apply_flip,
    "rotate": apply_rotate,
    "hsv": apply_hsv,
    "blur": apply_blur,
    "noise": apply_noise,
}

TECHNIQUE_PREFIXES = {
    "flip": "F",
    "rotate": "R",
    "hsv": "H",
    "blur": "B",
    "noise": "N",
}
