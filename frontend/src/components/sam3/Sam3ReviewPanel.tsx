import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Undo2, X } from "lucide-react";
import { ApiError } from "@/api/client";
import { getSam3Instances, getSam3Review, postSam3Decision, sam3ImageUrl } from "@/api/sam3";
import { Sam3ReviewCanvas } from "@/components/sam3/Sam3ReviewCanvas";
import { Sam3GatePanel } from "@/components/sam3/Sam3GatePanel";
import { Sam3RefinePanel } from "@/components/sam3/Sam3RefinePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { classColor } from "@/lib/yoloMath";
import { cn } from "@/lib/utils";
import type { Sam3Decision } from "@/types/sam3";

export function Sam3ReviewPanel({
  run,
  accept,
  reject,
  onGateChange,
}: {
  run: string;
  accept: string;
  reject: string;
  onGateChange: (accept: string, reject: string) => void;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [exemplarBox, setExemplarBox] = useState<[number, number, number, number] | null>(null);

  const { data: queue } = useQuery({
    queryKey: ["sam3-review", run, accept, reject],
    queryFn: () => getSam3Review(run, accept, reject),
    retry: false,
  });

  // The queue arrives most-uncertain-first and is kept in that order on purpose: a limited
  // review budget should be spent where the model is least sure.
  const items = useMemo(() => queue?.items ?? [], [queue]);
  const activeFile = file ?? items[0]?.file ?? null;

  const { data: detail } = useQuery({
    queryKey: ["sam3-instances", run, activeFile],
    queryFn: () => getSam3Instances(run, activeFile as string),
    enabled: !!activeFile,
    retry: false,
  });

  const decide = useMutation({
    mutationFn: (vars: { idx: number; decision: Sam3Decision | null }) =>
      postSam3Decision({ run, file: activeFile as string, idx: vars.idx, decision: vars.decision }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sam3-instances", run, activeFile] });
      queryClient.invalidateQueries({ queryKey: ["sam3-status", run] });
      queryClient.invalidateQueries({ queryKey: ["sam3-review", run] });
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save that decision"),
  });

  const instances = detail?.instances ?? [];
  const classes = detail?.classes ?? [];

  const goToFile = (offset: number) => {
    if (!items.length || !activeFile) return;
    const i = items.findIndex((it) => it.file === activeFile);
    const next = items[Math.min(items.length - 1, Math.max(0, i + offset))];
    if (next) {
      setFile(next.file);
      setSelectedIdx(null);
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (!instances.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        goToFile(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        goToFile(-1);
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedIdx((p) => (p == null ? 0 : Math.min(instances.length - 1, p + 1)));
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedIdx((p) => (p == null ? 0 : Math.max(0, p - 1)));
        return;
      }
      if (selectedIdx == null) return;

      const k = e.key.toLowerCase();
      if (k === "a") decide.mutate({ idx: selectedIdx, decision: "accept" });
      else if (k === "r") decide.mutate({ idx: selectedIdx, decision: "reject" });
      else if (k === "u") decide.mutate({ idx: selectedIdx, decision: null });
      else if (/^[1-9]$/.test(e.key)) {
        const cls = classes[Number(e.key) - 1];
        if (cls) decide.mutate({ idx: selectedIdx, decision: { cls: cls.id } });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, selectedIdx, classes, activeFile, items]);

  // An empty queue still renders the gate panel. Raising the accept gate is what empties the
  // queue, so hiding the controls here would strand the user with no way to lower it again.
  if (!items.length) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              Nothing is waiting for review at these thresholds. Everything scored either clearly
              above the accept gate or clearly below the reject gate.
            </p>
          </CardContent>
        </Card>
        <Sam3GatePanel run={run} accept={accept} reject={reject} onGateChange={onGateChange} />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[220px_1fr] gap-4 items-start">
      <Card className="max-h-[70vh] overflow-y-auto">
        <CardHeader className="sticky top-0 bg-card">
          <CardTitle className="text-sm">
            {queue?.total} image{queue?.total === 1 ? "" : "s"} to review
          </CardTitle>
          <p className="text-xs text-muted-foreground">Most uncertain first</p>
        </CardHeader>
        <CardContent className="space-y-1 p-2">
          {items.map((it) => (
            <button
              key={it.file}
              onClick={() => {
                setFile(it.file);
                setSelectedIdx(null);
              }}
              className={cn(
                "w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/50",
                activeFile === it.file && "bg-accent"
              )}
            >
              <div className="truncate font-mono">{it.file}</div>
              <div className="text-muted-foreground">{it.n_review} to decide</div>
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {activeFile && (
          <Sam3ReviewCanvas
            imageUrl={sam3ImageUrl(run, activeFile)}
            instances={instances}
            decisions={detail?.decisions ?? {}}
            selectedIdx={selectedIdx}
            onSelect={setSelectedIdx}
            onExemplarBox={setExemplarBox}
          />
        )}

        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => selectedIdx != null && decide.mutate({ idx: selectedIdx, decision: "accept" })}
                disabled={selectedIdx == null}
              >
                <Check className="h-4 w-4 mr-1" /> Accept <kbd className="ml-1 text-[10px]">A</kbd>
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => selectedIdx != null && decide.mutate({ idx: selectedIdx, decision: "reject" })}
                disabled={selectedIdx == null}
              >
                <X className="h-4 w-4 mr-1" /> Reject <kbd className="ml-1 text-[10px]">R</kbd>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => selectedIdx != null && decide.mutate({ idx: selectedIdx, decision: null })}
                disabled={selectedIdx == null}
              >
                <Undo2 className="h-4 w-4 mr-1" /> Clear <kbd className="ml-1 text-[10px]">U</kbd>
              </Button>
              <span className="text-xs text-muted-foreground ml-2">
                ← → instance · ↑ ↓ image · 1-9 set class
              </span>
            </div>

            <div className="flex flex-wrap gap-1">
              {classes.map((c, i) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant="secondary"
                  className="h-7"
                  disabled={selectedIdx == null}
                  onClick={() => selectedIdx != null && decide.mutate({ idx: selectedIdx, decision: { cls: c.id } })}
                >
                  <span
                    className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: classColor(c.id) }}
                  />
                  {i < 9 && <span className="text-muted-foreground mr-1 text-[10px]">{i + 1}</span>}
                  {c.name}
                </Button>
              ))}
            </div>

            <div className="space-y-1">
              {instances.map((inst, idx) => {
                const d = (detail?.decisions ?? {})[String(idx)];
                const label =
                  d === "accept" ? "accepted" : d === "reject" ? "rejected" : typeof d === "object" && d !== null ? "reclassified" : null;
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedIdx(idx)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1 text-xs hover:bg-accent/50",
                      selectedIdx === idx && "bg-accent"
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: classColor(inst.cls) }}
                      />
                      {classes.find((c) => c.id === inst.cls)?.name ?? `class ${inst.cls}`}
                      <span className="text-muted-foreground">{inst.score.toFixed(2)}</span>
                    </span>
                    {label && <Badge variant="secondary" className="text-[10px]">{label}</Badge>}
                  </button>
                );
              })}
            </div>

            {activeFile && (
              <Sam3RefinePanel
                run={run}
                file={activeFile}
                classes={classes}
                exemplarBox={exemplarBox}
                runIsActive={false}
              />
            )}
          </CardContent>
        </Card>

        <Sam3GatePanel run={run} accept={accept} reject={reject} onGateChange={onGateChange} />
      </div>
    </div>
  );
}
