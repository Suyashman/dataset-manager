import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowUp, Folder, Plus, Trash2, TriangleAlert } from "lucide-react";
import { ApiError } from "@/api/client";
import { browseSam3, startSam3Run } from "@/api/sam3";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ClassRow {
  id: number;
  name: string;
  prompts: string;
}

let nextRowId = 1;
const newRow = (): ClassRow => ({ id: nextRowId++, name: "", prompts: "" });

function defaultRunName() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `run_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function Sam3RunPanel({ onStarted }: { onStarted: (runName: string) => void }) {
  const [browsePath, setBrowsePath] = useState<string | undefined>(undefined);
  const [imagesDir, setImagesDir] = useState("");
  const [rows, setRows] = useState<ClassRow[]>([newRow()]);
  const [runName, setRunName] = useState(defaultRunName);
  const [sample, setSample] = useState("30");
  const [starting, setStarting] = useState(false);

  const { data: browse, isError, error } = useQuery({
    queryKey: ["sam3-browse", browsePath ?? "__default__"],
    queryFn: () => browseSam3(browsePath),
    retry: false,
  });

  const updateRow = (id: number, patch: Partial<ClassRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const handleStart = async () => {
    if (!imagesDir) {
      toast.error("Pick an image folder first");
      return;
    }
    const classes = rows
      .filter((r) => r.name.trim())
      .map((r) => ({
        name: r.name.trim(),
        // An empty prompt list means "use the class name" — the sidecar's load_classes does that.
        prompts: r.prompts.split(",").map((s) => s.trim()).filter(Boolean),
      }));
    if (!classes.length) {
      toast.error("Add at least one class");
      return;
    }
    if (!runName.trim()) {
      toast.error("Give the run a name");
      return;
    }

    setStarting(true);
    try {
      const n = Number(sample);
      await startSam3Run({
        images: imagesDir,
        classes,
        name: runName.trim(),
        ...(n > 0 ? { sample: n } : {}),
      });
      toast.success(`Started ${runName}`);
      onStarted(runName.trim());
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Failed to start the run");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Pick a folder of images</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={browse?.path ?? ""}
              onChange={(e) => setBrowsePath(e.target.value)}
              placeholder="Path on the machine running SAM3"
            />
            <Button
              variant="outline"
              size="icon"
              className="shrink-0"
              title="Up one level"
              onClick={() => browse && setBrowsePath(browse.parent)}
              disabled={!browse}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>

          {isError && (
            <p className="text-sm text-destructive">
              {error instanceof ApiError ? error.message : "Could not read that folder"}
            </p>
          )}

          {browse && (
            <>
              <div className="max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {browse.dirs.map((d) => (
                  <button
                    key={d.path}
                    onClick={() => setBrowsePath(d.path)}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-accent/50 text-left"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      {d.name}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">{d.images} images</span>
                  </button>
                ))}
                {browse.dirs.length === 0 && (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No subfolders here.</p>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {browse.images_here} image{browse.images_here === 1 ? "" : "s"} directly in this
                  folder
                </span>
                <Button size="sm" variant="secondary" onClick={() => setImagesDir(browse.path)}>
                  Use this folder
                </Button>
              </div>
            </>
          )}

          {imagesDir && (
            <p className="text-sm">
              Selected: <span className="font-mono text-xs">{imagesDir}</span>
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">2. Name the concepts to find</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 rounded-md border border-border bg-muted/40 p-3">
            <TriangleAlert className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Prompt wording and image resolution dominate results. <code>goggles</code> found 0
              instances at 640×360 and 251 on higher-resolution frames with the identical prompt.
              Run a sample of 30 first and read the per-class counts before committing a whole
              folder.
            </p>
          </div>

          <div className="grid grid-cols-[1fr_1.4fr_auto] gap-2 items-center">
            <Label className="text-xs">Class name</Label>
            <Label className="text-xs">Prompts (comma separated, blank = class name)</Label>
            <span />
            {rows.map((row) => (
              <ClassRowFields
                key={row.id}
                row={row}
                onChange={(patch) => updateRow(row.id, patch)}
                onRemove={rows.length > 1 ? () => setRows((p) => p.filter((r) => r.id !== row.id)) : undefined}
              />
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={() => setRows((p) => [...p, newRow()])}>
            <Plus className="h-4 w-4 mr-1" /> Add class
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">3. Start</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-xs">Run name</Label>
              <Input value={runName} onChange={(e) => setRunName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Sample size (blank or 0 = every image)</Label>
              <Input value={sample} onChange={(e) => setSample(e.target.value)} placeholder="30" />
            </div>
          </div>
          <Button className="w-full" onClick={handleStart} disabled={starting}>
            {starting ? "Starting..." : "Start annotation run"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ClassRowFields({
  row,
  onChange,
  onRemove,
}: {
  row: ClassRow;
  onChange: (patch: Partial<ClassRow>) => void;
  onRemove?: () => void;
}) {
  return (
    <>
      <Input
        value={row.name}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="person"
      />
      <Input
        value={row.prompts}
        onChange={(e) => onChange({ prompts: e.target.value })}
        placeholder="person, worker"
      />
      {onRemove ? (
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </Button>
      ) : (
        <span className="w-8" />
      )}
    </>
  );
}
