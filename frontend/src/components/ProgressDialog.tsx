import { useEffect } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { useJobPolling } from "@/hooks/useJobPolling";

interface ProgressDialogProps {
  jobId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: () => void;
  title?: string;
}

export function ProgressDialog({ jobId, open, onOpenChange, onComplete, title = "Processing" }: ProgressDialogProps) {
  const job = useJobPolling(jobId);

  const skipped = (job?.result?.images_skipped as number | undefined) ?? 0;

  useEffect(() => {
    if (job?.status === "completed") {
      if (skipped > 0) {
        toast.warning(`Completed, but ${skipped} file${skipped === 1 ? "" : "s"} were skipped — see details below`);
      } else {
        toast.success("Operation completed successfully");
      }
      onComplete?.();
    } else if (job?.status === "failed") {
      toast.error(job.error || "Operation failed");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  const errors = (job?.result?.errors as Array<{ file: string; reason: string }> | undefined) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {job?.status === "completed" && <CheckCircle2 className="h-5 w-5 text-green-500" />}
            {job?.status === "failed" && <XCircle className="h-5 w-5 text-destructive" />}
            {(!job || job.status === "running" || job.status === "pending") && (
              <Loader2 className="h-5 w-5 animate-spin" />
            )}
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Progress value={job?.progress.percent ?? 0} />
          <div className="text-sm text-muted-foreground">
            {job?.progress.current ?? 0} / {job?.progress.total ?? 0} — {job?.message ?? "Starting..."}
          </div>
          {job?.status === "failed" && <div className="text-sm text-destructive">{job.error}</div>}
          {errors.length > 0 && (
            <div className="max-h-32 overflow-y-auto text-xs text-muted-foreground border border-border rounded-md p-2 space-y-1">
              {errors.slice(0, 50).map((e, i) => (
                <div key={i}>
                  {e.file}: {e.reason}
                </div>
              ))}
            </div>
          )}
          {(job?.status === "completed" || job?.status === "failed") && (
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
