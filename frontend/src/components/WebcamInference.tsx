import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, CameraOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inferWebcamFrame } from "@/api/inference";
import { classColor, yoloToPixelBoxes } from "@/lib/yoloMath";
import type { DetectionBox, InferenceParams, SpeedInfo } from "@/types/inference";

const CAPTURE_INTERVAL_MS = 300;

export function WebcamInference({ params, disabled }: { params: InferenceParams; disabled: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const captureRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inFlightRef = useRef(false);

  const [running, setRunning] = useState(false);
  const [boxes, setBoxes] = useState<DetectionBox[]>([]);
  const [speed, setSpeed] = useState<SpeedInfo | null>(null);

  const stop = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRunning(false);
    setBoxes([]);
    setSpeed(null);
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setRunning(true);
    } catch {
      toast.error("Could not access camera — check browser permissions.");
    }
  };

  useEffect(() => () => stop(), []);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      if (inFlightRef.current) return;
      const video = videoRef.current;
      const capture = captureRef.current;
      if (!video || !capture || video.videoWidth === 0) return;

      capture.width = video.videoWidth;
      capture.height = video.videoHeight;
      const ctx = capture.getContext("2d");
      ctx?.drawImage(video, 0, 0);

      capture.toBlob(
        async (blob) => {
          if (!blob) return;
          inFlightRef.current = true;
          try {
            const res = await inferWebcamFrame(blob, params);
            setBoxes(res.boxes);
            setSpeed(res.speed);
          } catch {
            // Transient errors (model still loading, brief network hiccup) shouldn't stop the loop.
          } finally {
            inFlightRef.current = false;
          }
        },
        "image/jpeg",
        0.85
      );
    }, CAPTURE_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [running, params]);

  useEffect(() => {
    const video = videoRef.current;
    const canvas = overlayRef.current;
    if (!video || !canvas) return;
    const w = video.clientWidth;
    const h = video.clientHeight;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);

    for (const box of yoloToPixelBoxes(boxes, w, h)) {
      const color = classColor(box.classId);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      const label = `${box.className} ${boxes.find((b) => b.class_id === box.classId)?.confidence.toFixed(2) ?? ""}`;
      ctx.font = "12px sans-serif";
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.fillRect(box.x, Math.max(0, box.y - 16), textWidth + 8, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, box.x + 4, Math.max(12, box.y - 4));
    }
  }, [boxes]);

  return (
    <div className="space-y-3">
      {!running ? (
        <Button onClick={start} disabled={disabled}>
          <Camera className="h-4 w-4 mr-1" /> Start Camera
        </Button>
      ) : (
        <Button variant="destructive" onClick={stop}>
          <CameraOff className="h-4 w-4 mr-1" /> Stop Camera
        </Button>
      )}

      <div className="relative inline-block max-w-full border border-border rounded-md overflow-hidden bg-black">
        <video ref={videoRef} className="max-w-full block" muted playsInline />
        <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />
      </div>
      <canvas ref={captureRef} className="hidden" />

      {speed && (
        <p className="text-xs text-muted-foreground font-mono">
          {speed.total_ms.toFixed(0)}ms/frame · {speed.fps.toFixed(1)} FPS · {boxes.length} detection
          {boxes.length === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
