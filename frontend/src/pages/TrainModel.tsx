import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Cpu, Square, Zap } from "lucide-react";
import { listDatasetNames } from "@/api/datasets";
import { getDeviceInfo, listRuns, startTraining, stopTraining } from "@/api/training";
import { MODEL_VARIANTS } from "@/types/training";
import { useJobPolling } from "@/hooks/useJobPolling";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MetricsChart } from "@/components/MetricsChart";

// Keeps the field free-typed while editing (so clearing it and typing "10" doesn't first
// render "0" then "010"), and strips leading zeros without blocking an in-progress "0".
const stripLeadingZeros = (v: string) => v.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
// Same idea as stripLeadingZeros but for decimals like learning rate (e.g. "0.01").
const stripLeadingZerosDecimal = (v: string) => v.replace(/[^\d.]/g, "").replace(/^0+(?=\d)/, "");

export function TrainModel() {
  const { data: datasetNames } = useQuery({ queryKey: ["dataset-names"], queryFn: listDatasetNames });
  const { data: deviceInfo } = useQuery({ queryKey: ["device-info"], queryFn: getDeviceInfo });
  const { data: runs } = useQuery({ queryKey: ["training-runs"], queryFn: listRuns });

  const [dataset, setDataset] = useState("");
  const [model, setModel] = useState("yolov8n");
  const [epochsStr, setEpochsStr] = useState("50");
  const [batchStr, setBatchStr] = useState("16");
  const [imgszStr, setImgszStr] = useState("640");
  const [device, setDevice] = useState("cpu");
  const [lr0Str, setLr0Str] = useState("0.01");
  const [patienceStr, setPatienceStr] = useState("100");
  const [resumeRun, setResumeRun] = useState("");
  const [resumeWeights, setResumeWeights] = useState<"best" | "last">("best");
  const [jobId, setJobId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const job = useJobPolling(jobId);
  const isTraining = job?.status === "running" || job?.status === "pending";
  const selectedRun = runs?.find((r) => r.run_name === resumeRun);

  const handleSubmit = async () => {
    if (!dataset) {
      toast.error("Choose a dataset to train on");
      return;
    }
    const epochs = parseInt(epochsStr, 10) || 1;
    const batch = parseInt(batchStr, 10) || 1;
    const imgsz = parseInt(imgszStr, 10) || 640;
    const lr0 = parseFloat(lr0Str) || 0.01;
    const patience = parseInt(patienceStr, 10) || 100;
    setSubmitting(true);
    try {
      const { job_id } = await startTraining({
        dataset,
        model,
        epochs,
        batch,
        imgsz,
        device,
        lr0,
        patience,
        resume_run: resumeRun || null,
        resume_weights: resumeWeights,
      });
      setJobId(job_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start training");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStop = async () => {
    if (!jobId) return;
    setStopping(true);
    try {
      await stopTraining(jobId);
      toast.info("Stopping training after the current epoch...");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to stop training");
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-1">Train Model</h1>
      <p className="text-muted-foreground mb-6">
        Train a YOLO model directly on any dataset in this manager. Training runs locally on your machine.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Dataset</Label>
            <Select value={dataset} onValueChange={setDataset} disabled={isTraining}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose dataset" />
              </SelectTrigger>
              <SelectContent>
                {(datasetNames ?? []).map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Model variant{resumeRun && <span className="text-muted-foreground font-normal"> (ignored — using checkpoint weights)</span>}</Label>
            <Select value={model} onValueChange={setModel} disabled={isTraining || !!resumeRun}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODEL_VARIANTS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Epochs</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={epochsStr}
                onChange={(e) => setEpochsStr(stripLeadingZeros(e.target.value))}
                disabled={isTraining}
              />
            </div>
            <div className="space-y-2">
              <Label>Batch size</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={batchStr}
                onChange={(e) => setBatchStr(stripLeadingZeros(e.target.value))}
                disabled={isTraining}
              />
            </div>
            <div className="space-y-2">
              <Label>Image size</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={imgszStr}
                onChange={(e) => setImgszStr(stripLeadingZeros(e.target.value))}
                disabled={isTraining}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Learning rate (lr0){resumeWeights === "last" && resumeRun && <span className="text-muted-foreground font-normal"> (ignored — resuming)</span>}</Label>
              <Input
                type="text"
                inputMode="decimal"
                value={lr0Str}
                onChange={(e) => setLr0Str(stripLeadingZerosDecimal(e.target.value))}
                disabled={isTraining || (resumeWeights === "last" && !!resumeRun)}
              />
            </div>
            <div className="space-y-2">
              <Label>Early stop patience{resumeWeights === "last" && resumeRun && <span className="text-muted-foreground font-normal"> (ignored — resuming)</span>}</Label>
              <Input
                type="text"
                inputMode="numeric"
                value={patienceStr}
                onChange={(e) => setPatienceStr(stripLeadingZeros(e.target.value))}
                disabled={isTraining || (resumeWeights === "last" && !!resumeRun)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Device</Label>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={device === "cpu" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDevice("cpu")}
                  disabled={isTraining}
                >
                  <Cpu className="h-4 w-4 mr-1" /> CPU
                </Button>
                <Badge variant="outline">{deviceInfo?.cpu_name ?? "Detecting..."}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={device === "0" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setDevice("0")}
                  disabled={isTraining || !deviceInfo?.cuda_available}
                >
                  <Zap className="h-4 w-4 mr-1" /> GPU
                </Button>
                <Badge variant={deviceInfo?.cuda_available ? "secondary" : "outline"}>
                  {deviceInfo ? (deviceInfo.cuda_available ? deviceInfo.device_name : "No GPU detected") : "Detecting..."}
                </Badge>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Continue from a previous run (optional)</Label>
            <Select
              value={resumeRun || "__none__"}
              onValueChange={(v) => {
                const run = runs?.find((r) => r.run_name === v);
                setResumeRun(v === "__none__" ? "" : v);
                setResumeWeights(run?.is_interrupted && run.has_last ? "last" : "best");
              }}
              disabled={isTraining}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Train from scratch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Train from scratch</SelectItem>
                {(runs ?? []).map((r) => (
                  <SelectItem key={r.run_name} value={r.run_name}>
                    {r.run_name} {r.is_interrupted ? `(interrupted at ${r.completed_epochs}/${r.total_epochs})` : "(completed)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedRun && (
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant={resumeWeights === "best" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setResumeWeights("best")}
                  disabled={isTraining || !selectedRun.has_best}
                >
                  Fine-tune from best.pt
                </Button>
                <Button
                  type="button"
                  variant={resumeWeights === "last" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setResumeWeights("last")}
                  disabled={isTraining || !selectedRun.has_last || !selectedRun.is_interrupted}
                >
                  Resume from last.pt
                </Button>
              </div>
            )}
            {selectedRun && resumeWeights === "last" && (
              <p className="text-xs text-muted-foreground">
                Continues the same run in place toward epoch {selectedRun.total_epochs}. Hyperparameters above are
                reused from the original run.
              </p>
            )}
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={submitting || isTraining}>
            {isTraining ? "Training..." : resumeRun ? (resumeWeights === "last" ? "Resume Training" : "Fine-tune") : "Start Training"}
          </Button>
        </CardContent>
      </Card>

      {job && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Status</span>
              <div className="flex items-center gap-2">
                {isTraining && (
                  <Button variant="destructive" size="sm" onClick={handleStop} disabled={stopping}>
                    <Square className="h-3.5 w-3.5 mr-1" /> Stop
                  </Button>
                )}
                <Badge
                  variant={
                    job.status === "completed" ? "secondary" : job.status === "failed" ? "destructive" : "outline"
                  }
                >
                  {job.status}
                </Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Epoch {job.batch_progress?.epoch ?? job.progress.current}/{job.batch_progress?.total_epochs ?? job.progress.total}
                </span>
                {job.device_used && (
                  <span>
                    Running on <span className="font-mono">{job.device_used}</span>
                    {job.device_used.startsWith("cuda") ? " (GPU)" : " (CPU)"}
                  </span>
                )}
              </div>
              <Progress value={job.progress.percent} />

              {job.batch_progress && (
                <>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
                    <span>
                      Batch {job.batch_progress.batch}/{job.batch_progress.total_batches} ·{" "}
                      {job.batch_progress.images_done}/{job.batch_progress.images_total} images
                    </span>
                    <span>{job.batch_progress.speed_it_s.toFixed(1)} it/s</span>
                  </div>
                  <Progress
                    value={(job.batch_progress.batch / job.batch_progress.total_batches) * 100}
                    className="h-1"
                  />
                  <p className="text-xs text-muted-foreground font-mono pt-1">
                    {Object.entries(job.batch_progress.losses)
                      .map(([k, v]) => `${k.split("/").pop()}=${v.toFixed(3)}`)
                      .join("  ")}
                  </p>
                </>
              )}

              {!job.batch_progress && <p className="text-xs text-muted-foreground pt-1">{job.message}</p>}
            </div>

            {job.status === "failed" && job.error && (
              <p className="text-sm text-destructive">{job.error}</p>
            )}

            {job.status === "completed" && job.result && (
              <p className="text-sm text-muted-foreground">
                Best weights saved to{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">{String(job.result.weights_path)}</code>
              </p>
            )}

            {job.metrics.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <MetricsChart metrics={job.metrics} metricKey="train/box_loss" label="Train box loss" color="#ef4444" />
                <MetricsChart metrics={job.metrics} metricKey="val/box_loss" label="Val box loss" color="#f97316" />
                <MetricsChart
                  metrics={job.metrics}
                  metricKey="metrics/mAP50(B)"
                  label="mAP50"
                  color="#22c55e"
                />
                <MetricsChart
                  metrics={job.metrics}
                  metricKey="metrics/mAP50-95(B)"
                  label="mAP50-95"
                  color="#3b82f6"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
