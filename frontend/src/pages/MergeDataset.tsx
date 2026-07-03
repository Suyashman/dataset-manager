import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { listDatasetNames, mergeMulti } from "@/api/datasets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProgressDialog } from "@/components/ProgressDialog";
import { ClassFilterEditor, type ClassFilterState } from "@/components/ClassFilterEditor";

const ALL_SPLITS = ["train", "valid", "test"];

interface SourceRow {
  id: number;
  source: string;
  prefix: string;
  classFilter: Record<string, ClassFilterState>;
}

let nextRowId = 1;
const newRow = (): SourceRow => ({ id: nextRowId++, source: "", prefix: "", classFilter: {} });

export function MergeDataset() {
  const navigate = useNavigate();
  const { data: datasetNames } = useQuery({ queryKey: ["dataset-names"], queryFn: listDatasetNames });

  const [destination, setDestination] = useState("");
  const [splits, setSplits] = useState<string[]>(ALL_SPLITS);
  const [rows, setRows] = useState<SourceRow[]>([newRow()]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isExisting = !!destination && (datasetNames ?? []).includes(destination);

  const toggleSplit = (s: string) =>
    setSplits((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const updateRow = (id: number, patch: Partial<SourceRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRow = (id: number) => setRows((prev) => prev.filter((r) => r.id !== id));

  const handleSubmit = async () => {
    if (!destination.trim()) {
      toast.error("Give the merged dataset a name");
      return;
    }
    if (rows.some((r) => !r.source || !r.prefix)) {
      toast.error("Every source needs a dataset and a prefix");
      return;
    }
    const prefixes = rows.map((r) => r.prefix.toUpperCase());
    if (new Set(prefixes).size !== prefixes.length) {
      toast.error("Each source needs a distinct prefix");
      return;
    }
    for (const r of rows) {
      const kept = Object.entries(r.classFilter).filter(([, v]) => v.keep);
      if (Object.keys(r.classFilter).length > 0 && kept.length === 0) {
        toast.error(`Keep at least one class for ${r.source}`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const sources = rows.map((r) => {
        const kept = Object.entries(r.classFilter).filter(([, v]) => v.keep);
        return {
          source: r.source,
          prefix: r.prefix.toUpperCase(),
          class_filter: Object.fromEntries(kept.map(([id, v]) => [id, v.name])),
        };
      });
      const { job_id } = await mergeMulti({ destination, sources, splits_to_include: splits });
      setJobId(job_id);
      setDialogOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start job");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-1">Merge Datasets</h1>
      <p className="text-muted-foreground mb-6">
        Combine one or more Roboflow exports into a single master dataset. Classes are unified automatically across
        every source, label files are rewritten, and filenames never collide — no manual editing required.
      </p>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Destination</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Master dataset name</Label>
            <div className="flex items-center gap-2">
              <Input
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder="PPE_Master"
              />
              {destination.trim() && (
                <Badge variant={isExisting ? "secondary" : "outline"} className="shrink-0">
                  {isExisting ? "existing dataset" : "will be created"}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Use an existing dataset name to add more sources into it, or a new name to create it from scratch.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Splits to include</Label>
            <div className="flex gap-2">
              {ALL_SPLITS.map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant={splits.includes(s) ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleSplit(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4 mt-4">
        {rows.map((row, idx) => (
          <Card key={row.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Source {idx + 1}</CardTitle>
              {rows.length > 1 && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeRow(row.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Source dataset</Label>
                <Select
                  value={row.source}
                  onValueChange={(v) => updateRow(row.id, { source: v, classFilter: {} })}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose source" />
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
                <Label>Prefix</Label>
                <Input
                  value={row.prefix}
                  onChange={(e) => updateRow(row.id, { prefix: e.target.value.toUpperCase() })}
                  placeholder={`P${idx + 1}`}
                  maxLength={4}
                />
              </div>
              {row.source && (
                <ClassFilterEditor
                  source={row.source}
                  value={row.classFilter}
                  onChange={(v) => updateRow(row.id, { classFilter: v })}
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Button variant="outline" className="w-full mt-3" onClick={() => setRows((prev) => [...prev, newRow()])}>
        <Plus className="h-4 w-4 mr-1" /> Add another source dataset
      </Button>

      <Button className="w-full mt-4" onClick={handleSubmit} disabled={submitting}>
        Merge {rows.length > 1 ? `${rows.length} Datasets` : "Dataset"}
      </Button>

      <ProgressDialog
        jobId={jobId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={`Merging into ${destination || "dataset"}`}
        onComplete={() => navigate(`/datasets/${encodeURIComponent(destination)}`)}
      />
    </div>
  );
}
