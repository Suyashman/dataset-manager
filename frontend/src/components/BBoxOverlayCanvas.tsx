import { useEffect, useRef, useState } from "react";
import { classColor, yoloToPixelBoxes } from "@/lib/yoloMath";
import type { LabelBox } from "@/types/image";

interface BBoxOverlayCanvasProps {
  imageUrl: string;
  boxes: LabelBox[];
  onResolution?: (w: number, h: number) => void;
}

export function BBoxOverlayCanvas({ imageUrl, boxes, onResolution }: BBoxOverlayCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  const draw = () => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || !naturalSize) return;

    const displayW = img.clientWidth;
    const displayH = img.clientHeight;
    canvas.width = displayW;
    canvas.height = displayH;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, displayW, displayH);

    const pixelBoxes = yoloToPixelBoxes(boxes, displayW, displayH);
    for (const box of pixelBoxes) {
      const color = classColor(box.classId);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      ctx.font = "12px sans-serif";
      const label = box.className;
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.fillRect(box.x, Math.max(0, box.y - 16), textWidth + 8, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, box.x + 4, Math.max(12, box.y - 4));
    }
  };

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalSize, boxes]);

  useEffect(() => {
    const observer = new ResizeObserver(() => draw());
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naturalSize]);

  return (
    <div ref={containerRef} className="relative inline-block max-w-full">
      <img
        ref={imgRef}
        src={imageUrl}
        alt="preview"
        className="max-w-full h-auto block"
        onLoad={(e) => {
          const w = e.currentTarget.naturalWidth;
          const h = e.currentTarget.naturalHeight;
          setNaturalSize({ w, h });
          onResolution?.(w, h);
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" />
    </div>
  );
}
