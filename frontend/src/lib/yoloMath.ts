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

export function classColor(classId: number): string {
  const hue = (classId * 137.508) % 360; // golden-angle distribution for distinct hues
  return `hsl(${hue}, 80%, 55%)`;
}
