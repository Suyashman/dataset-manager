import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { TriangleAlert } from "lucide-react";
import { ApiError } from "@/api/client";
import { getDataset, listDatasetNames } from "@/api/datasets";
import { exportSam3, importSam3Export, previewSam3Export } from "@/api/sam3";
import { ProgressDialog } from "@/components/ProgressDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ALL_SPLITS = ["train", "valid", "test"];

export function Sam3ExportPanel({
  run,
  accept,
  reject,
}: {
  run: string;
  accept: string;
  reject: string;
}) {
  const navigate = useNavigate();
  const [out, setOut] = useState("");
  const [val, setVal] = useState("0.2");
  const [groupByDir, setGroupByDir] = useState(true);
  const [copyImages, setCopyImages] = useState(true);
  const [manifest, setManifest] = useState<string | null>(null);
  const [stderr, setStderr] = useState("");

  const [destination, setDestination] = useState("");
  const [prefix, setPrefix] = useState("");
  const [splits, setSplits] = useState<string[]>(ALL_SPLITS);
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: datasetNames } = useQuery({ queryKey: ["dataset-names"], queryFn: listDatasetNames });
  const isExisting = !!destination && (datasetNames ?? []).includes(destination);

  const { data: preview } = useQuery({
    queryKey: ["sam3-export-preview", out, manifest],
    queryFn: () => previewSam3Export(out),
    enabled: !!manifest && !!out,
    retry: false,
  });

  const { data: destDetail } = useQuery({
    queryKey: ["dataset", destination],
    queryFn: () => getDataset(destination),
    enabled: isExisting,
    retry: false,
  });

  const runExport = useMutation({
    mutationFn: () =>
      exportSam3({
        run,
        out,
        accept,
        reject,
        val: Number(val) || 0,
        group_by_dir: groupByDir,
        copy_images: copyImages,
      }),
    onSuccess: (r) => {
      setManifest(r.manifest);
      setStderr(r.stderr ?? "");
      toast[r.ok ? "success" : "error"](r.ok ? "Export written" : "Export reported a problem");
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : "Export failed"),
  });

  const startImport = async () => {
    if (!destination.trim() || !prefix.trim()) {
      toast.error("Destination dataset and prefix are both required");
      return;
    }
    const class_filter = Object.keys(renames).length
      ? Object.fromEntries(
          Object.entries(preview?.classes ?? {}).map(([id, name]) => [id, renames[id] || name])
        )
      : null;
    try {
      const { job_id } = await importSam3Export({
        export_dir: out,
        destination: destination.trim(),
        prefix: prefix.trim().toUpperCase(),
        splits_to_include: splits,
        class_filter,
      });
      setJobId(job_id);
      setDialogOpen(true);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not start the import");
    }
  };

  const destClassNames = Object.values(destDetail?.classes ?? {});

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Export the reviewed run</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label className="text-xs">Output directory (on the SAM3 machine)</Label>
            <Input value={out} onChange={(e) => setOut(e.target.value)} placeholder="exports/ppe_run1" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs">Validation fraction</Label>
              <Input type="number" step="0.05" min="0" max="1" value={val} onChange={(e) => setVal(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Gate (from the Review tab)</Label>
              <p className="text-sm font-mono pt-1.5">
                accept {accept} · reject {reject}
              </p>
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 cursor-pointer">
            <Checkbox checked={groupByDir} onCheckedChange={(c) => setGroupByDir(c === true)} className="mt-0.5" />
            <span className="space-y-1">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <TriangleAlert className="h-3.5 w-3.5 text-muted-foreground" />
                Keep each subfolder wholly in train or valid
              </span>
              <span className="block text-xs text-muted-foreground">
                Turn this on when subfolders are frames from one camera. 30 frames from one camera
                are near-duplicates — split them randomly and near-copies of training images land in
                validation, making the score fiction.
              </span>
            </span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox checked={copyImages} onCheckedChange={(c) => setCopyImages(c === true)} />
            <span className="text-sm">Copy images instead of symlinking</span>
          </label>

          <Button className="w-full" onClick={() => runExport.mutate()} disabled={!out || runExport.isPending}>
            {runExport.isPending ? "Exporting..." : "Export"}
          </Button>

          {manifest && (
            <pre className="max-h-56 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs">
              {manifest}
            </pre>
          )}
          {stderr && <pre className="text-xs text-destructive whitespace-pre-wrap">{stderr}</pre>}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">2. Import into a dataset</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>{preview.total_images} images</span>
              {Object.entries(preview.split_counts).map(([s, n]) => (
                <span key={s} className="text-muted-foreground">
                  {s} {n}
                </span>
              ))}
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Destination dataset</Label>
              <div className="flex items-center gap-2">
                <Input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="PPE_Master"
                  list="sam3-dataset-names"
                />
                <datalist id="sam3-dataset-names">
                  {(datasetNames ?? []).map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                {destination.trim() && (
                  <Badge variant={isExisting ? "secondary" : "outline"} className="shrink-0">
                    {isExisting ? "existing dataset" : "will be created"}
                  </Badge>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Prefix</Label>
              <Input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value.toUpperCase())}
                placeholder="S1"
                maxLength={4}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Splits to include</Label>
              <div className="flex gap-2">
                {ALL_SPLITS.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={splits.includes(s) ? "default" : "outline"}
                    onClick={() =>
                      setSplits((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]))
                    }
                  >
                    {s}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Class mapping</Label>
              <p className="text-xs text-muted-foreground">
                Classes merge by exact, case-sensitive name. <code>goggle</code> will not match an
                existing <code>goggles</code> — it creates a new class.
              </p>
              <div className="space-y-1">
                {Object.entries(preview.classes).map(([id, name]) => {
                  const effective = renames[id] || name;
                  const matches = isExisting && destClassNames.includes(effective);
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <span className="w-28 truncate text-sm">{name}</span>
                      <Input
                        className="h-8 w-40"
                        value={renames[id] ?? ""}
                        onChange={(e) => setRenames((p) => ({ ...p, [id]: e.target.value }))}
                        placeholder={`rename (default ${name})`}
                      />
                      {isExisting && (
                        <Badge variant={matches ? "secondary" : "outline"} className="text-[10px]">
                          {matches ? "matches existing class" : "will be created"}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <Button className="w-full" onClick={startImport}>
              Import into {destination.trim() || "dataset"}
            </Button>
          </CardContent>
        </Card>
      )}

      <ProgressDialog
        jobId={jobId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={`Importing into ${destination || "dataset"}`}
        onComplete={() => navigate(`/datasets/${encodeURIComponent(destination)}`)}
      />
    </div>
  );
}
