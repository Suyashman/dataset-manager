import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Cpu, Zap } from "lucide-react";
import { listRuns, getDeviceInfo } from "@/api/training";
import { inferImage, inferImages, inferVideo } from "@/api/inference";
import { useJobPolling } from "@/hooks/useJobPolling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WebcamInference } from "@/components/WebcamInference";
import type { ImageInferenceResult, InferenceParams } from "@/types/inference";

export function InferenceStudio() {
  const { data: runs } = useQuery({ queryKey: ["training-runs"], queryFn: listRuns });
  const { data: deviceInfo } = useQuery({ queryKey: ["device-info"], queryFn: getDeviceInfo });

  const [runName, setRunName] = useState("");
  const [weights, setWeights] = useState<"best" | "last">("best");
  const [device, setDevice] = useState("cpu");
  const [confStr, setConfStr] = useState("0.25");
  const [iouStr, setIouStr] = useState("0.45");

  const selectedRun = runs?.find((r) => r.run_name === runName);
  const modelReady = !!runName;
  const params: InferenceParams = {
    run_name: runName,
    weights,
    device,
    conf: parseFloat(confStr) || 0.25,
    iou: parseFloat(iouStr) || 0.45,
  };

  // --- Single image ---
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [singleResult, setSingleResult] = useState<ImageInferenceResult | null>(null);
  const [singleLoading, setSingleLoading] = useState(false);

  const runSingle = async () => {
    if (!modelReady) return toast.error("Choose a trained model first");
    if (!singleFile) return toast.error("Choose an image");
    setSingleLoading(true);
    try {
      setSingleResult(await inferImage(singleFile, params));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Inference failed");
    } finally {
      setSingleLoading(false);
    }
  };

  // --- Multiple images ---
  const [multiFiles, setMultiFiles] = useState<File[]>([]);
  const [multiResults, setMultiResults] = useState<ImageInferenceResult[]>([]);
  const [multiLoading, setMultiLoading] = useState(false);

  const runMulti = async () => {
    if (!modelReady) return toast.error("Choose a trained model first");
    if (multiFiles.length === 0) return toast.error("Choose images");
    setMultiLoading(true);
    try {
      const res = await inferImages(multiFiles, params);
      setMultiResults(res.results);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Inference failed");
    } finally {
      setMultiLoading(false);
    }
  };

  // --- Video ---
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [strideStr, setStrideStr] = useState("3");
  const [videoJobId, setVideoJobId] = useState<string | null>(null);
  const [videoSubmitting, setVideoSubmitting] = useState(false);
  const videoJob = useJobPolling(videoJobId);
  const videoRunning = videoJob?.status === "running" || videoJob?.status === "pending";

  const runVideo = async () => {
    if (!modelReady) return toast.error("Choose a trained model first");
    if (!videoFile) return toast.error("Choose a video");
    setVideoSubmitting(true);
    try {
      const { job_id } = await inferVideo(videoFile, params, parseInt(strideStr, 10) || 1);
      setVideoJobId(job_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start video inference");
    } finally {
      setVideoSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold mb-1">Inference Studio</h1>
      <p className="text-muted-foreground mb-6">
        Test a trained model on a single image, a batch of images, a video, or your live webcam.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model &amp; Parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Trained model</Label>
            <Select value={runName} onValueChange={setRunName}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a training run" />
              </SelectTrigger>
              <SelectContent>
                {(runs ?? []).map((r) => (
                  <SelectItem key={r.run_name} value={r.run_name}>
                    {r.run_name} {r.dataset ? `(${r.dataset})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Checkpoint</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={weights === "best" ? "default" : "outline"}
                  onClick={() => setWeights("best")}
                  disabled={!selectedRun?.has_best}
                >
                  best.pt
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={weights === "last" ? "default" : "outline"}
                  onClick={() => setWeights("last")}
                  disabled={!selectedRun?.has_last}
                >
                  last.pt
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Device</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={device === "cpu" ? "default" : "outline"} onClick={() => setDevice("cpu")}>
                  <Cpu className="h-3.5 w-3.5 mr-1" /> CPU
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={device === "0" ? "default" : "outline"}
                  onClick={() => setDevice("0")}
                  disabled={!deviceInfo?.cuda_available}
                >
                  <Zap className="h-3.5 w-3.5 mr-1" /> GPU
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Confidence threshold</Label>
              <Input type="number" step={0.05} min={0} max={1} value={confStr} onChange={(e) => setConfStr(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Minimum confidence to keep a detection. Lower it if a model trained on few images shows nothing.
              </p>
            </div>
            <div className="space-y-2">
              <Label>IoU threshold</Label>
              <Input type="number" step={0.05} min={0} max={1} value={iouStr} onChange={(e) => setIouStr(e.target.value)} />
              <p className="text-xs text-muted-foreground">
                Controls duplicate-box removal. Lower it if the same object gets boxed more than once.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="image" className="mt-4">
        <TabsList>
          <TabsTrigger value="image">Single Image</TabsTrigger>
          <TabsTrigger value="images">Multiple Images</TabsTrigger>
          <TabsTrigger value="video">Video</TabsTrigger>
          <TabsTrigger value="webcam">Webcam</TabsTrigger>
        </TabsList>

        <TabsContent value="image" className="space-y-4">
          <div className="flex items-center gap-2">
            <Input type="file" accept="image/*" onChange={(e) => setSingleFile(e.target.files?.[0] ?? null)} />
            <Button onClick={runSingle} disabled={singleLoading}>
              {singleLoading ? "Running..." : "Run Inference"}
            </Button>
          </div>
          {singleResult && (
            <Card>
              <CardContent className="space-y-3 pt-4">
                <img src={singleResult.annotated_url} alt="annotated result" className="max-w-full rounded-md border border-border" />
                <div className="flex flex-wrap gap-2">
                  {singleResult.boxes.map((b, i) => (
                    <Badge key={i} variant="outline">
                      {b.class_name} {(b.confidence * 100).toFixed(0)}%
                    </Badge>
                  ))}
                  {singleResult.boxes.length === 0 && (
                    <span className="text-sm text-muted-foreground">
                      No detections above the confidence threshold. If this model was trained on very few images or
                      epochs, try lowering the confidence threshold above.
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground font-mono">
                  {singleResult.speed.total_ms.toFixed(1)}ms ({singleResult.speed.preprocess_ms.toFixed(1)} pre +{" "}
                  {singleResult.speed.inference_ms.toFixed(1)} infer + {singleResult.speed.postprocess_ms.toFixed(1)} post) ·{" "}
                  {singleResult.speed.fps.toFixed(1)} FPS
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="images" className="space-y-4">
          <div className="flex items-center gap-2">
            <Input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setMultiFiles(Array.from(e.target.files ?? []))}
            />
            <Button onClick={runMulti} disabled={multiLoading}>
              {multiLoading ? "Running..." : `Run on ${multiFiles.length || ""} Images`}
            </Button>
          </div>
          {multiResults.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {multiResults.map((r, i) => (
                <Card key={i}>
                  <CardContent className="p-2 space-y-1">
                    <img src={r.annotated_url} alt={r.filename} className="w-full aspect-square object-cover rounded-md" />
                    <p className="text-xs truncate">{r.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.boxes.length} detection{r.boxes.length === 1 ? "" : "s"} · {r.speed.fps.toFixed(1)} FPS
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="video" className="space-y-4">
          <div className="flex items-center gap-2">
            <Input type="file" accept="video/*" onChange={(e) => setVideoFile(e.target.files?.[0] ?? null)} disabled={videoRunning} />
            <div className="flex items-center gap-2 shrink-0">
              <Label className="text-xs whitespace-nowrap">Every Nth frame</Label>
              <Input
                type="number"
                min={1}
                className="w-16"
                value={strideStr}
                onChange={(e) => setStrideStr(e.target.value)}
                disabled={videoRunning}
              />
            </div>
            <Button onClick={runVideo} disabled={videoSubmitting || videoRunning}>
              {videoRunning ? "Processing..." : "Run Inference"}
            </Button>
          </div>

          {videoJob && (
            <Card>
              <CardContent className="space-y-3 pt-4">
                <div className="space-y-1">
                  <Progress value={videoJob.progress.percent} />
                  <p className="text-xs text-muted-foreground">{videoJob.message}</p>
                </div>
                {videoJob.status === "failed" && <p className="text-sm text-destructive">{videoJob.error}</p>}
                {videoJob.status === "completed" && videoJob.result && (
                  <>
                    <video controls className="max-w-full rounded-md border border-border" src={String(videoJob.result.output_url)} />
                    <p className="text-xs text-muted-foreground font-mono">
                      {String(videoJob.result.frames_processed)}/{String(videoJob.result.frames_total)} frames processed ·{" "}
                      {String(videoJob.result.total_detections)} total detections · avg {String(videoJob.result.avg_fps)} FPS
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="webcam">
          <WebcamInference params={params} disabled={!modelReady} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
