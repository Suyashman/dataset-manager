import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { listDatasetNames, createDataset } from "@/api/datasets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProgressDialog } from "@/components/ProgressDialog";
import { ClassFilterEditor, type ClassFilterState } from "@/components/ClassFilterEditor";

const ALL_SPLITS = ["train", "valid", "test"];

export function CreateDataset() {
  const navigate = useNavigate();
  const { data: datasetNames } = useQuery({ queryKey: ["dataset-names"], queryFn: listDatasetNames });

  const [source, setSource] = useState("");
  const [newName, setNewName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [splits, setSplits] = useState<string[]>(ALL_SPLITS);
  const [classFilter, setClassFilter] = useState<Record<string, ClassFilterState>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const toggleSplit = (s: string) =>
    setSplits((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const handleSubmit = async () => {
    if (!source || !newName || !prefix) {
      toast.error("Please fill in source dataset, new name, and prefix");
      return;
    }
    const kept = Object.entries(classFilter).filter(([, v]) => v.keep);
    if (Object.keys(classFilter).length > 0 && kept.length === 0) {
      toast.error("Keep at least one class");
      return;
    }
    setSubmitting(true);
    try {
      const class_filter = Object.fromEntries(kept.map(([id, v]) => [id, v.name]));
      const { job_id } = await createDataset({
        source,
        new_name: newName,
        prefix,
        splits_to_include: splits,
        class_filter,
      });
      setJobId(job_id);
      setDialogOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start job");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-1">Create New Dataset</h1>
      <p className="text-muted-foreground mb-6">
        Pick a dataset folder already placed under <code>datasets/</code>, give it a new name and prefix.
      </p>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dataset details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Select source dataset</Label>
            <Select
              value={source}
              onValueChange={(v) => {
                setSource(v);
                setClassFilter({});
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a dataset folder" />
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
            <Label>New dataset name</Label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="PPE_Master" />
          </div>
          <div className="space-y-2">
            <Label>Image prefix</Label>
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} placeholder="H" maxLength={4} />
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
          {source && <ClassFilterEditor source={source} value={classFilter} onChange={setClassFilter} />}
          <Button className="w-full" onClick={handleSubmit} disabled={submitting}>
            Create Dataset
          </Button>
        </CardContent>
      </Card>

      <ProgressDialog
        jobId={jobId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={`Creating ${newName || "dataset"}`}
        onComplete={() => navigate(`/datasets/${encodeURIComponent(newName)}`)}
      />
    </div>
  );
}
