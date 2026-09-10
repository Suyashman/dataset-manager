import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { ApiError } from "@/api/client";
import { adoptSam3, refineSam3 } from "@/api/sam3";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { classColor } from "@/lib/yoloMath";
import type { Sam3RefinedInstance } from "@/types/sam3";

export function Sam3RefinePanel({
  run,
  file,
  classes,
  exemplarBox,
  runIsActive,
}: {
  run: string;
  file: string;
  classes: { id: number; name: string }[];
  exemplarBox: [number, number, number, number] | null;
  runIsActive: boolean;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [threshold, setThreshold] = useState("0.25");
  const [results, setResults] = useState<Sam3RefinedInstance[] | null>(null);
  const [adoptCls, setAdoptCls] = useState<number | null>(null);
  const [confirmAdopt, setConfirmAdopt] = useState(false);

  const find = useMutation({
    mutationFn: () =>
      refineSam3({
        run,
        file,
        ...(text.trim() ? { text: text.trim() } : {}),
        boxes: exemplarBox ? [exemplarBox] : [],
        labels: exemplarBox ? [1] : [],
        threshold: Number(threshold) || 0.25,
      }),
    onSuccess: (r) => {
      setResults(r.instances);
      toast.success(`Found ${r.instances.length}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Refine failed"),
  });

  const adopt = useMutation({
    mutationFn: () =>
      adoptSam3({ run, file, cls: adoptCls as number, instances: results ?? [] }),
    onSuccess: (r) => {
      setConfirmAdopt(false);
      setResults(null);
      toast.success(`Replaced this image's instances with ${r.n}`);
      queryClient.invalidateQueries({ queryKey: ["sam3-instances", run, file] });
      queryClient.invalidateQueries({ queryKey: ["sam3-status", run] });
      queryClient.invalidateQueries({ queryKey: ["sam3-review", run] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Adopt failed"),
  });

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Find similar</span>
      </div>

      <p className="text-xs text-muted-foreground">
        Drag a box on the image around one example, then search. A positive example is the reliable
        control here: negative examples only nudge the concept and were measured not to reliably
        suppress the instance they cover — to remove something for certain, use Reject, which is a
        filter and cannot fail.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Optional text prompt</Label>
          <Input
            className="h-8 w-48"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="worker in a blue coat"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Threshold</Label>
          <Input
            className="h-8 w-24"
            type="number"
            step="0.05"
            min="0"
            max="1"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          onClick={() => find.mutate()}
          disabled={find.isPending || (!exemplarBox && !text.trim())}
        >
          {find.isPending ? "Searching..." : "Find similar"}
        </Button>
        {exemplarBox && (
          <span className="text-xs text-muted-foreground">
            box {exemplarBox.map((v) => v.toFixed(2)).join(", ")}
          </span>
        )}
      </div>

      {results && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {results.length} result{results.length === 1 ? "" : "s"}:{" "}
            {results.map((r) => r.score.toFixed(2)).join(" · ")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs">Adopt as:</span>
            {classes.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={adoptCls === c.id ? "default" : "secondary"}
                className="h-7"
                onClick={() => setAdoptCls(c.id)}
              >
                <span
                  className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: classColor(c.id) }}
                />
                {c.name}
              </Button>
            ))}
            <Button
              size="sm"
              onClick={() => setConfirmAdopt(true)}
              disabled={adoptCls == null || runIsActive}
              title={runIsActive ? "Cannot edit predictions while a run is active" : undefined}
            >
              Adopt
            </Button>
          </div>
          {runIsActive && (
            <p className="text-xs text-muted-foreground">
              Adopting is disabled while a run is writing predictions.
            </p>
          )}
        </div>
      )}

      <Dialog open={confirmAdopt} onOpenChange={setConfirmAdopt}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Replace this image's instances?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Adopting replaces <em>every</em> instance on this image with the {results?.length ?? 0}{" "}
            found, and clears its decisions — the old instance indices stop meaning anything once
            the list changes.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAdopt(false)}>
              Cancel
            </Button>
            <Button onClick={() => adopt.mutate()} disabled={adopt.isPending}>
              Replace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
