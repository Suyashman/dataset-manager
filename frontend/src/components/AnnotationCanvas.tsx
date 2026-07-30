import { useEffect, useRef, useState } from "react";
import { classColor } from "@/lib/yoloMath";

export interface EditableBox {
  id: string;
  class_id: number;
  x_center: number;
  y_center: number;
  width: number;
  height: number;
}

interface AnnotationCanvasProps {
  imageUrl: string;
  boxes: EditableBox[];
  classColors: Record<number, string>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onBoxesChange: (boxes: EditableBox[]) => void;
  pendingClassId: number;
}

const HANDLE_SIZE = 8;
const MIN_BOX_PX = 6;

type DragMode =
  | { type: "draw"; startX: number; startY: number; id: string }
  | { type: "move"; id: string; startX: number; startY: number; origBox: EditableBox }
  | { type: "resize"; id: string; corner: "nw" | "ne" | "sw" | "se"; origBox: EditableBox }
  | null;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

let nextBoxId = 1;
export function newBoxId() {
  return `box_${nextBoxId++}`;
}

export function AnnotationCanvas({
  imageUrl,
  boxes,
  classColors,
  selectedId,
  onSelect,
  onBoxesChange,
  pendingClassId,
}: AnnotationCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<DragMode>(null);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;

  // boxesRef only reflects `boxes` after React re-renders, which can lag behind rapid-fire
  // mouse events within the same drag gesture. Updating it synchronously here (in addition to
  // the prop callback) guarantees the very next mousemove/mouseup always sees the latest boxes,
  // even a freshly-drawn one from the same mousedown.
  const updateBoxes = (next: EditableBox[]) => {
    boxesRef.current = next;
    onBoxesChange(next);
  };

  const getDisplaySize = () => {
    const img = imgRef.current;
    return img ? { w: img.clientWidth, h: img.clientHeight } : { w: 0, h: 0 };
  };

  const toPixel = (b: EditableBox) => {
    const { w, h } = getDisplaySize();
    return {
      x: (b.x_center - b.width / 2) * w,
      y: (b.y_center - b.height / 2) * h,
      width: b.width * w,
      height: b.height * h,
    };
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !naturalSize) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    for (const b of boxes) {
      const p = toPixel(b);
      const color = classColors[b.class_id] ?? classColor(b.class_id);
      const isSelected = b.id === selectedId;
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.strokeRect(p.x, p.y, p.width, p.height);

      if (isSelected) {
        const corners: [number, number][] = [
          [p.x, p.y],
          [p.x + p.width, p.y],
          [p.x, p.y + p.height],
          [p.x + p.width, p.y + p.height],
        ];
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = color;
        for (const [cx, cy] of corners) {
          ctx.fillRect(cx - HANDLE_SIZE / 2, cy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
          ctx.strokeRect(cx - HANDLE_SIZE / 2, cy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        }
      }
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(draw, [boxes, selectedId, naturalSize, classColors]);

  useEffect(() => {
    const observer = new ResizeObserver(draw);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalSize]);

  const hitTestHandle = (mx: number, my: number, box: EditableBox): "nw" | "ne" | "sw" | "se" | null => {
    const p = toPixel(box);
    const corners: ["nw" | "ne" | "sw" | "se", number, number][] = [
      ["nw", p.x, p.y],
      ["ne", p.x + p.width, p.y],
      ["sw", p.x, p.y + p.height],
      ["se", p.x + p.width, p.y + p.height],
    ];
    for (const [name, cx, cy] of corners) {
      if (Math.abs(mx - cx) <= HANDLE_SIZE && Math.abs(my - cy) <= HANDLE_SIZE) return name;
    }
    return null;
  };

  const hitTestBox = (mx: number, my: number): EditableBox | null => {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const p = toPixel(boxes[i]);
      if (mx >= p.x && mx <= p.x + p.width && my >= p.y && my <= p.y + p.height) return boxes[i];
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Without this, starting a new box anywhere inside an existing one (e.g. drawing eyewear
    // within a person box — PPE annotations nest constantly) always hit-tests the existing box
    // first and drags it instead. Shift bypasses both hit-tests below so a new box always starts
    // under the cursor; release Shift to go back to selecting/moving/resizing as normal.
    const forceDraw = e.shiftKey;

    if (!forceDraw && selectedId) {
      const selBox = boxes.find((b) => b.id === selectedId);
      if (selBox) {
        const handle = hitTestHandle(mx, my, selBox);
        if (handle) {
          dragRef.current = { type: "resize", id: selBox.id, corner: handle, origBox: selBox };
          return;
        }
      }
    }

    if (!forceDraw) {
      const hit = hitTestBox(mx, my);
      if (hit) {
        onSelect(hit.id);
        dragRef.current = { type: "move", id: hit.id, startX: mx, startY: my, origBox: hit };
        return;
      }
    }

    const id = newBoxId();
    const { w, h } = getDisplaySize();
    const box: EditableBox = { id, class_id: pendingClassId, x_center: mx / w, y_center: my / h, width: 0, height: 0 };
    onSelect(null);
    dragRef.current = { type: "draw", startX: mx, startY: my, id };
    updateBoxes([...boxes, box]);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = clamp(e.clientX - rect.left, 0, rect.width);
    const my = clamp(e.clientY - rect.top, 0, rect.height);
    const { w, h } = getDisplaySize();
    if (w === 0 || h === 0) return;

    if (drag.type === "draw") {
      const x1 = Math.min(drag.startX, mx);
      const x2 = Math.max(drag.startX, mx);
      const y1 = Math.min(drag.startY, my);
      const y2 = Math.max(drag.startY, my);
      updateBoxes(
        boxesRef.current.map((b) =>
          b.id === drag.id
            ? { ...b, x_center: (x1 + x2) / 2 / w, y_center: (y1 + y2) / 2 / h, width: (x2 - x1) / w, height: (y2 - y1) / h }
            : b
        )
      );
    } else if (drag.type === "move") {
      const dx = (mx - drag.startX) / w;
      const dy = (my - drag.startY) / h;
      updateBoxes(
        boxesRef.current.map((b) =>
          b.id === drag.id
            ? {
                ...b,
                x_center: clamp(drag.origBox.x_center + dx, b.width / 2, 1 - b.width / 2),
                y_center: clamp(drag.origBox.y_center + dy, b.height / 2, 1 - b.height / 2),
              }
            : b
        )
      );
    } else if (drag.type === "resize") {
      const origPixel = toPixel(drag.origBox);
      let x = origPixel.x;
      let y = origPixel.y;
      let width = origPixel.width;
      let height = origPixel.height;
      const x2 = x + width;
      const y2 = y + height;
      if (drag.corner === "nw") {
        width = x2 - mx;
        height = y2 - my;
        x = mx;
        y = my;
      } else if (drag.corner === "ne") {
        width = mx - x;
        height = y2 - my;
        y = my;
      } else if (drag.corner === "sw") {
        width = x2 - mx;
        height = my - y;
        x = mx;
      } else {
        width = mx - x;
        height = my - y;
      }
      if (width < 1 || height < 1) return;
      updateBoxes(
        boxesRef.current.map((b) =>
          b.id === drag.id
            ? { ...b, x_center: (x + width / 2) / w, y_center: (y + height / 2) / h, width: width / w, height: height / h }
            : b
        )
      );
    }
  };

  const handleMouseUp = () => {
    const drag = dragRef.current;
    if (drag?.type === "draw") {
      const { w, h } = getDisplaySize();
      const box = boxesRef.current.find((b) => b.id === drag.id);
      if (box && box.width * w >= MIN_BOX_PX && box.height * h >= MIN_BOX_PX) {
        onSelect(box.id);
      } else {
        updateBoxes(boxesRef.current.filter((b) => b.id !== drag.id));
      }
    }
    dragRef.current = null;
  };

  return (
    <div ref={containerRef} className="relative inline-block max-w-full select-none">
      <img
        ref={imgRef}
        src={imageUrl}
        alt="annotate"
        className="max-w-full max-h-[70vh] w-auto h-auto block"
        draggable={false}
        onLoad={(e) => setNaturalSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
}
