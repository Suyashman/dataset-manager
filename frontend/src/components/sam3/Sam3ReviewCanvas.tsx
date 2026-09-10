import { useEffect, useRef, useState } from "react";
import { classColor } from "@/lib/yoloMath";
import type { Sam3Decision, Sam3Instance } from "@/types/sam3";

/** A few px of slack around an instance, for the same reason AnnotationCanvas has it: a goggles
 * polygon is only a handful of screen pixels tall and a pixel-perfect test is an easy miss. */
const HIT_TOLERANCE = 4;
/** Below this drag distance the gesture is a click (select), above it an exemplar box. */
const DRAG_THRESHOLD = 5;

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function pointInPolygon(px: number, py: number, pts: number[]): boolean {
  const n = pts.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2];
    const yi = pts[i * 2 + 1];
    const xj = pts[j * 2];
    const yj = pts[j * 2 + 1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function decisionOf(decisions: Record<string, Sam3Decision>, idx: number) {
  return decisions[String(idx)];
}

export function Sam3ReviewCanvas({
  imageUrl,
  instances,
  decisions,
  selectedIdx,
  onSelect,
  onExemplarBox,
}: {
  imageUrl: string;
  instances: Sam3Instance[];
  decisions: Record<string, Sam3Decision>;
  selectedIdx: number | null;
  onSelect: (idx: number | null) => void;
  onExemplarBox?: (box: [number, number, number, number]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<Rect | null>(null);

  const draw = () => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    if (!w || !h) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    instances.forEach((inst, idx) => {
      const d = decisionOf(decisions, idx);
      const rejected = d === "reject";
      // A reclassify decision ({cls}) recolours the instance to the class it was moved to.
      const shownCls = typeof d === "object" && d !== null ? d.cls : inst.cls;
      const color = classColor(shownCls);
      const selected = selectedIdx === idx;

      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < inst.poly.length; i += 2) {
        const x = inst.poly[i] * w;
        const y = inst.poly[i + 1] * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      ctx.globalAlpha = rejected ? 0.25 : 1;
      ctx.setLineDash(rejected ? [5, 4] : []);
      ctx.lineWidth = selected ? 3 : d === "accept" || typeof d === "object" ? 2 : 1.5;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.globalAlpha = rejected ? 0.05 : selected ? 0.25 : 0.12;
      ctx.fillStyle = color;
      ctx.fill();
      ctx.restore();
    });

    if (drag) {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(drag.x1, drag.y1, drag.x2 - drag.x1, drag.y2 - drag.y1);
      ctx.restore();
    }
  };

  useEffect(draw, [instances, decisions, selectedIdx, ready, drag]);

  useEffect(() => {
    const observer = new ResizeObserver(() => draw());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const toLocal = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const hitTest = (x: number, y: number): number | null => {
    const img = imgRef.current;
    if (!img) return null;
    const w = img.clientWidth;
    const h = img.clientHeight;
    // Topmost first, so the instance drawn last wins an overlap.
    for (let idx = instances.length - 1; idx >= 0; idx--) {
      const poly = instances[idx].poly;
      const pts: number[] = [];
      for (let i = 0; i < poly.length; i += 2) pts.push(poly[i] * w, poly[i + 1] * h);
      if (pointInPolygon(x, y, pts)) return idx;
      const [bx1, by1, bx2, by2] = instances[idx].box;
      if (
        x >= bx1 * w - HIT_TOLERANCE &&
        x <= bx2 * w + HIT_TOLERANCE &&
        y >= by1 * h - HIT_TOLERANCE &&
        y <= by2 * h + HIT_TOLERANCE
      ) {
        return idx;
      }
    }
    return null;
  };

  return (
    <div ref={containerRef} className="relative inline-block max-w-full select-none">
      <img
        ref={imgRef}
        src={imageUrl}
        alt="frame under review"
        className="max-w-full h-auto block"
        onLoad={() => setReady(true)}
      />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-crosshair"
        onMouseDown={(e) => {
          const p = toLocal(e);
          dragStart.current = p;
        }}
        onMouseMove={(e) => {
          if (!dragStart.current) return;
          const p = toLocal(e);
          setDrag({
            x1: Math.min(dragStart.current.x, p.x),
            y1: Math.min(dragStart.current.y, p.y),
            x2: Math.max(dragStart.current.x, p.x),
            y2: Math.max(dragStart.current.y, p.y),
          });
        }}
        onMouseUp={(e) => {
          const start = dragStart.current;
          dragStart.current = null;
          if (!start) return;
          const p = toLocal(e);
          const moved = Math.hypot(p.x - start.x, p.y - start.y);
          setDrag(null);
          if (moved < DRAG_THRESHOLD) {
            onSelect(hitTest(p.x, p.y));
            return;
          }
          const img = imgRef.current;
          if (!img || !onExemplarBox) return;
          const w = img.clientWidth;
          const h = img.clientHeight;
          onExemplarBox([
            Math.min(start.x, p.x) / w,
            Math.min(start.y, p.y) / h,
            Math.max(start.x, p.x) / w,
            Math.max(start.y, p.y) / h,
          ]);
        }}
        onMouseLeave={() => {
          dragStart.current = null;
          setDrag(null);
        }}
      />
    </div>
  );
}
