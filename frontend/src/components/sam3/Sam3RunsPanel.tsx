import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { cancelSam3Run, getSam3Status, listSam3Runs } from "@/api/sam3";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

function formatEta(seconds: number | null) {
  if (seconds == null) return null;
  if (seconds < 90) return `${Math.round(seconds)}s`;
  return `${(seconds / 60).toFixed(1)}m`;
}

export function Sam3RunsPanel({
  selectedRun,
  onSelectRun,
  accept,
  reject,
}: {
  selectedRun: string | null;
  onSelectRun: (run: string) => void;
  accept: string;
  reject: string;
}) {
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const { data: runs, isLoading } = useQuery({
    queryKey: ["sam3-runs"],
    queryFn: listSam3Runs,
    retry: false,
  });

  // Annotation progress is polled from the sidecar, not from job_service: the job lives in the
  // sidecar's own process, which owns the subprocess and derives progress by counting lines in
  // predictions.jsonl. Mirroring it into our job store would create a second source of truth.
  const { data: status } = useQuery({
    queryKey: ["sam3-status", selectedRun, accept, reject],
    queryFn: () => getSam3Status(selectedRun as string, accept, reject),
    enabled: !!selectedRun,
    retry: false,
    refetchInterval: (query) => (query.state.data?.running ? 1000 : false),
  });

  const cancel = useMutation({
    mutationFn: () => cancelSam3Run(selectedRun as string),
    onSuccess: (res) => {
      setConfirmCancel(false);
      toast[res.cancelled ? "success" : "message"](
        res.cancelled ? "Cancelled" : "Nothing was running"
      );
      queryClient.invalidateQueries({ queryKey: ["sam3-status"] });
      queryClient.invalidateQueries({ queryKey: ["sam3-runs"] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not cancel"),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground">Loading runs...</p>}
          {runs?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No runs yet. Start one from the Run tab.
            </p>
          )}
          {runs?.map((r) => {
            const pct = r.total ? (r.done / r.total) * 100 : 0;
            return (
              <button
                key={r.name}
                onClick={() => onSelectRun(r.name)}
                className={cn(
                  "w-full rounded-md border p-3 text-left space-y-2 hover:bg-accent/40",
                  selectedRun === r.name ? "border-foreground" : "border-border"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{r.name}</span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {r.done}/{r.total}
                  </span>
                </div>
                <Progress value={pct} />
                <div className="flex flex-wrap gap-1">
                  {r.classes.map((c) => (
                    <Badge key={c} variant="secondary" className="text-[10px]">
                      {c}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground font-mono truncate">{r.images}</p>
              </button>
            );
          })}
        </CardContent>
      </Card>

      {status && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{status.run}</CardTitle>
            {status.running && (
              <Button variant="destructive" size="sm" onClick={() => setConfirmCancel(true)}>
                Cancel run
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <Progress value={status.total ? (status.done / status.total) * 100 : 0} />
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>
                {status.done} / {status.total} images
              </span>
              {status.rate != null && <span>{status.rate.toFixed(2)} img/s</span>}
              {formatEta(status.eta) && <span>eta {formatEta(status.eta)}</span>}
              <span className="text-muted-foreground">{status.instances} instances</span>
              {status.empty_images > 0 && (
                <span className="text-muted-foreground">
                  {status.empty_images} image{status.empty_images === 1 ? "" : "s"} with nothing
                  found
                </span>
              )}
            </div>

            {status.log && (
              <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs">
                {status.log}
              </pre>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancel this run?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This kills the GPU job. Images already written to predictions.jsonl are kept, so
            restarting the same run resumes from where it stopped.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>
              Keep running
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancel.mutate()}
              disabled={cancel.isPending}
            >
              Cancel run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
