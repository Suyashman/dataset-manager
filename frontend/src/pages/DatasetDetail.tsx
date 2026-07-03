import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, Files, FolderTree, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteDataset, getDataset } from "@/api/datasets";
import { getStats, getValidation } from "@/api/stats";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
  if (h.event === "cloned_from") {
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

  const { data: detail, isLoading } = useQuery({ queryKey: ["dataset", name], queryFn: () => getDataset(name) });
  const { data: stats } = useQuery({ queryKey: ["stats", name], queryFn: () => getStats(name) });
  const { data: validation } = useQuery({ queryKey: ["validation", name], queryFn: () => getValidation(name) });

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

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold mb-1">{detail.name}</h1>
          <p className="text-muted-foreground mb-6">
            {formatBytes(detail.size_bytes)} · last modified {formatDate(detail.last_modified)}
          </p>
        </div>
        <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmOpen(true)}>
          <Trash2 className="h-4 w-4 mr-1" /> Delete Dataset
        </Button>
      </div>

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

        <TabsContent value="validation">{validation && <ValidationReportPanel report={validation} />}</TabsContent>
      </Tabs>
    </div>
  );
}
