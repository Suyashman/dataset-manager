import type { LabelBox } from "@/types/image";

export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
  classId: number;
  className: string;
}

export function yoloToPixelBoxes(boxes: LabelBox[], imgWidth: number, imgHeight: number): PixelBox[] {
  return boxes.map((b) => ({
    x: (b.x_center - b.width / 2) * imgWidth,
    y: (b.y_center - b.height / 2) * imgHeight,
    width: b.width * imgWidth,
    height: b.height * imgHeight,
    classId: b.class_id,
    className: b.class_name,
  }));
}

// Hex (not hsl()) so the same string can feed a native <input type="color"> picker directly.
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (n: number) =>
    Math.round(f(n) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(0)}${toHex(8)}${toHex(4)}`;
}

export function classColor(classId: number): string {
  const hue = (classId * 137.508) % 360; // golden-angle distribution for distinct hues
  return hslToHex(hue, 80, 55);
}
