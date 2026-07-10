import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Database, Files, FolderTree, Shuffle, SprayCan, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError } from "@/api/client";
import { deleteDataset, getDataset, resplitDataset } from "@/api/datasets";
import { getStats, getValidation } from "@/api/stats";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatCard } from "@/components/StatCard";
import { ClassTable } from "@/components/ClassTable";
import { ValidationReportPanel } from "@/components/ValidationReportPanel";
import { ImageGrid } from "@/components/ImageGrid";
import { formatBytes, formatDate } from "@/lib/format";
import type { HistoryEvent } from "@/types/dataset";

function describeHistoryEvent(h: HistoryEvent): string {
  if (h.event === "augmented" && h.techniques) {
    const parts = Object.entries(h.techniques)
      .map(([type, count]) => `${type}: ${count}`)
      .join(", ");
    return `${h.source_dataset} (${parts}), ${h.images_added} images added`;
  }
  if (h.event === "cloned_from" || h.event === "forked_from") {
    return `${h.source_dataset}`;
  }
  return `${h.source_dataset} (prefix ${h.prefix}), ${h.images_added} images`;
}

export function DatasetDetail() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [validPct, setValidPct] = useState("20");
  const [testPct, setTestPct] = useState("0");
  const [splitting, setSplitting] = useState(false);

  const { data: detail, isLoading, isError, error } = useQuery({
    queryKey: ["dataset", name],
    queryFn: () => getDataset(name),
    // A 404 here means the dataset genuinely doesn't exist — retrying won't change that, and
    // not retrying means this settles into an error state immediately instead of potentially
    // sitting in a retry-scheduled/paused fetchStatus.
    retry: false,
  });
  const { data: stats } = useQuery({ queryKey: ["stats", name], queryFn: () => getStats(name), enabled: !isError });
  const { data: validation, isFetching: validationFetching } = useQuery({
    queryKey: ["validation", name],
    queryFn: () => getValidation(name),
    enabled: !isError,
  });

  if (isError) {
    return (
      <div>
        <Link to="/datasets">
          <Button variant="ghost" size="sm" className="mb-4 -ml-2">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Datasets
          </Button>
        </Link>
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : `Dataset '${name}' could not be loaded.`}
        </p>
      </div>
    );
  }

  if (isLoading || !detail) {
    return <Skeleton className="h-64" />;
  }

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteDataset(name);
      toast.success(`Deleted ${name}`);
      queryClient.invalidateQueries({ queryKey: ["datasets"] });
      navigate("/datasets");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete dataset");
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  const validNum = Number(validPct) || 0;
  const testNum = Number(testPct) || 0;
  const trainNum = Math.max(0, 100 - validNum - testNum);

  const handleSplit = async () => {
    if (validNum + testNum > 100) {
      toast.error("Valid % + Test % can't exceed 100");
      return;
    }
    setSplitting(true);
    try {
      const res = await resplitDataset(name, { train: trainNum / 100, valid: validNum / 100, test: testNum / 100 });
      toast.success(`Split into train: ${res.splits.train}, valid: ${res.splits.valid}, test: ${res.splits.test}`);
      await queryClient.invalidateQueries({ queryKey: ["dataset", name] });
      await queryClient.invalidateQueries({ queryKey: ["images", name] });
      setSplitOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to split dataset");
    } finally {
      setSplitting(false);
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">{detail.name}</h1>
          <p className="text-muted-foreground mb-6">
            {formatBytes(detail.size_bytes)} · last modified {formatDate(detail.last_modified)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate(`/annotate/${encodeURIComponent(name)}`)}>
            <SprayCan className="h-4 w-4 mr-1" /> Clean Dataset
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSplitOpen(true)}>
            <Shuffle className="h-4 w-4 mr-1" /> Split Dataset
          </Button>
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Delete Dataset
          </Button>
        </div>
      </div>

      <Dialog open={splitOpen} onOpenChange={setSplitOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Split {name}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Pools every image currently in the dataset (any split) and reshuffles them into train/valid/test by the
            percentages below. This moves files — it isn't additive, and re-running it re-shuffles from scratch.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Train %</Label>
              <Input value={trainNum} disabled className="text-center" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Valid %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={validPct}
                onChange={(e) => setValidPct(e.target.value)}
                className="text-center"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Test %</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={testPct}
                onChange={(e) => setTestPct(e.target.value)}
                className="text-center"
              />
            </div>
          </div>
          {detail && (
            <p className="text-xs text-muted-foreground">
              ≈ {Math.round((detail.total_images * trainNum) / 100)} train ·{" "}
              {Math.round((detail.total_images * validNum) / 100)} valid ·{" "}
              {Math.round((detail.total_images * testNum) / 100)} test (of {detail.total_images} total)
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSplitOpen(false)} disabled={splitting}>
              Cancel
            </Button>
            <Button onClick={handleSplit} disabled={splitting}>
              {splitting ? "Splitting..." : "Split"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {name}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently deletes the dataset folder and its metadata (numbering, class mapping, history). This
            cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard icon={Database} label="Total Images" value={detail.total_images} />
        <StatCard icon={Tag} label="Classes" value={Object.keys(detail.classes).length} />
        <StatCard icon={FolderTree} label="Splits" value={Object.keys(detail.splits).length} />
        <StatCard icon={Files} label="Labels" value={stats?.num_labels ?? "—"} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>
          <TabsTrigger value="validation">Validation</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div>
            <h3 className="text-sm font-medium mb-2">Split counts</h3>
            <div className="flex gap-4 text-sm text-muted-foreground">
              {Object.entries(detail.splits).map(([split, count]) => (
                <span key={split}>
                  {split}: {count}
                </span>
              ))}
            </div>
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">Classes</h3>
            <ClassTable classes={detail.classes} />
          </div>
          <div>
            <h3 className="text-sm font-medium mb-2">History</h3>
            <div className="space-y-2 text-sm text-muted-foreground">
              {detail.history.length === 0 && <div>No history recorded yet.</div>}
              {[...detail.history].reverse().map((h, i) => (
                <div key={i} className="border border-border rounded-md px-3 py-2">
                  <div>
                    <span className="font-medium text-foreground">{h.event}</span> — {describeHistoryEvent(h)} —{" "}
                    {formatDate(h.timestamp)}
                  </div>
                  {!!h.images_skipped && (
                    <div className="text-destructive mt-1">
                      {h.images_skipped} file{h.images_skipped === 1 ? "" : "s"} skipped due to copy errors — check
                      the Logs page for details.
                      {h.errors && h.errors.length > 0 && (
                        <ul className="list-disc list-inside mt-1 text-xs">
                          {h.errors.slice(0, 5).map((e, j) => (
                            <li key={j}>
                              {e.file}: {e.reason}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="images">
          <ImageGrid dataset={name} />
        </TabsContent>

        <TabsContent value="stats">
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard icon={Database} label="Total Images" value={stats.total_images} />
              <StatCard icon={Files} label="Total Labels" value={stats.num_labels} />
              <StatCard icon={Tag} label="Classes" value={stats.num_classes} />
              <StatCard icon={Database} label="Avg Images/Class" value={stats.avg_images_per_class.toFixed(1)} />
              <StatCard icon={Database} label="Missing Labels" value={stats.missing_labels} />
              <StatCard icon={Database} label="Missing Images" value={stats.missing_images} />
              <StatCard icon={Database} label="Duplicate Images" value={stats.duplicate_images} />
              <StatCard icon={Database} label="Duplicate Filenames" value={stats.duplicate_labels} />
              <StatCard icon={Database} label="Corrupted Files" value={stats.corrupted_files} />
              <StatCard icon={Database} label="Empty Label Files" value={stats.empty_label_files} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="validation">
          {validation && (
            <ValidationReportPanel
              dataset={name}
              report={validation}
              refreshing={validationFetching}
              onRefresh={() => {
                queryClient.invalidateQueries({ queryKey: ["validation", name] });
                queryClient.invalidateQueries({ queryKey: ["stats", name] });
              }}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
