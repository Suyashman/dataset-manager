import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Plus, Trash2, Upload } from "lucide-react";
import { getDataset } from "@/api/datasets";
import { listImages, getImageUrl, getLabel } from "@/api/images";
import { addClass, importFolder, saveBoxes } from "@/api/annotation";
import { AnnotationCanvas, newBoxId, type EditableBox } from "@/components/AnnotationCanvas";
import { classColor } from "@/lib/yoloMath";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function AnnotationWorkspace() {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: detail } = useQuery({ queryKey: ["dataset", name], queryFn: () => getDataset(name) });

  const classes: Record<number, string> = {};
  if (detail) for (const [k, v] of Object.entries(detail.classes)) classes[Number(k)] = v;
  const sortedClassIds = Object.keys(classes).map(Number).sort((a, b) => a - b);

  const [classColors, setClassColors] = useState<Record<number, string>>({});
  const getClassColor = (id: number) => classColors[id] ?? classColor(id);

  // Position is remembered per-dataset so leaving mid-review and coming back resumes here.
  const [currentIndex, setCurrentIndex] = useState(() => {
    const saved = Number(localStorage.getItem(`annotate-position:${name}`));
    return Number.isFinite(saved) && saved > 0 ? saved : 0;
  });
  const [jumpValue, setJumpValue] = useState("");

  useEffect(() => {
    localStorage.setItem(`annotate-position:${name}`, String(currentIndex));
  }, [name, currentIndex]);

  // One image fetched at a time via page_size=1 so this scales to datasets with thousands of
  // images instead of preloading a thumbnail list up front.
  const { data: pageData, isLoading: imageLoading } = useQuery({
    queryKey: ["image-at", name, currentIndex],
    queryFn: () => listImages(name, undefined, currentIndex + 1, 1),
    placeholderData: keepPreviousData,
  });
  const currentImage = pageData?.items[0];
  const total = pageData?.total ?? 0;

  // A position saved from a previously larger dataset can point past the end — snap back.
  useEffect(() => {
    if (pageData && total > 0 && currentIndex >= total) setCurrentIndex(total - 1);
  }, [pageData, total, currentIndex]);

  const { data: label } = useQuery({
    queryKey: ["label", name, currentImage?.split, currentImage?.filename],
    queryFn: () => getLabel(name, currentImage.split, currentImage.filename),
    enabled: !!currentImage,
    retry: false,
  });

  const [boxes, setBoxes] = useState<EditableBox[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingClassId, setPendingClassId] = useState(0);
  const [newClassName, setNewClassName] = useState("");
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const skipNextSaveRef = useRef(false);
  const pendingSaveRef = useRef<{ split: string; filename: string; boxes: EditableBox[] } | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!label) return;
    skipNextSaveRef.current = true;
    setBoxes(
      label.boxes.map((b) => ({
        id: newBoxId(),
        class_id: b.class_id,
        x_center: b.x_center,
        y_center: b.y_center,
        width: b.width,
        height: b.height,
      }))
    );
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label]);

  const flushSave = () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (pendingSaveRef.current) {
      const { split, filename, boxes: b } = pendingSaveRef.current;
      pendingSaveRef.current = null;
      setSaving(true);
      saveBoxes(
        name,
        split,
        filename,
        b.map(({ class_id, x_center, y_center, width, height }) => ({ class_id, x_center, y_center, width, height }))
      )
        .then(() => queryClient.invalidateQueries({ queryKey: ["image-at", name] }))
        .catch(() => toast.error("Failed to save annotations"))
        .finally(() => setSaving(false));
    }
  };

  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (!currentImage) return;
    pendingSaveRef.current = { split: currentImage.split, filename: currentImage.filename, boxes };
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushSave, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes]);

  useEffect(() => () => flushSave(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        setBoxes((prev) => prev.filter((b) => b.id !== selectedId));
        setSelectedId(null);
      } else if (e.key === "ArrowRight") {
        goTo(currentIndex + 1);
      } else if (e.key === "ArrowLeft") {
        goTo(currentIndex - 1);
      } else if (/^[1-9]$/.test(e.key)) {
        // Only sets which class the *next* box you draw uses — deliberately does not reassign
        // the currently selected box, unlike clicking a class in the sidebar.
        const id = sortedClassIds[Number(e.key) - 1];
        if (id !== undefined) setPendingClassId(id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, currentIndex, total, sortedClassIds.join(",")]);

  const goTo = (i: number) => {
    if (i < 0 || i >= total) return;
    flushSave();
    setCurrentIndex(i);
  };

  const handleJump = () => {
    const n = Number(jumpValue);
    if (Number.isFinite(n) && n >= 1 && n <= total) goTo(n - 1);
    setJumpValue("");
  };

  const handleDone = () => {
    flushSave();
    navigate(`/datasets/${encodeURIComponent(name)}`);
  };

  const handleAddClass = async () => {
    const trimmed = newClassName.trim();
    if (!trimmed) return;
    try {
      const res = await addClass(name, trimmed);
      await queryClient.invalidateQueries({ queryKey: ["dataset", name] });
      setPendingClassId(res.class_id);
      setNewClassName("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add class");
    }
  };

  const assignClass = (classId: number) => {
    setPendingClassId(classId);
    if (selectedId) {
      setBoxes((prev) => prev.map((b) => (b.id === selectedId ? { ...b, class_id: classId } : b)));
    }
  };

  const deleteBox = (id: string) => {
    setBoxes((prev) => prev.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <div>
      <Link to={`/datasets/${encodeURIComponent(name)}`}>
        <Button variant="ghost" size="sm" className="mb-2 -ml-2">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to {name}
        </Button>
      </Link>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold">{name}</h1>
          <p className="text-xs text-muted-foreground">
            {total > 0 ? `Image ${currentIndex + 1} of ${total}` : imageLoading ? "Loading…" : "No images yet"}
            {saving && " · Saving..."}
          </p>
        </div>
        <Button size="sm" onClick={() => setImportOpen(true)}>
          <Upload className="h-4 w-4 mr-1" /> Import Images
        </Button>
      </div>

      {imageLoading && !pageData ? (
        <Skeleton className="h-96 w-full" />
      ) : total === 0 ? (
        <div className="border border-dashed border-border rounded-md p-12 text-center text-muted-foreground">
          No images yet. Click "Import Images" to bring in a folder from your computer.
        </div>
      ) : (
        <div className="grid grid-cols-[180px_1fr] gap-4 items-start">
          <div className="space-y-3">
            <Label className="text-xs">Classes</Label>
            <div className="space-y-1">
              {sortedClassIds.map((id, i) => (
                <div
                  key={id}
                  className={cn(
                    "flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-sm border",
                    pendingClassId === id ? "border-foreground" : "border-transparent hover:bg-accent/50"
                  )}
                >
                  <input
                    type="color"
                    value={getClassColor(id)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setClassColors((prev) => ({ ...prev, [id]: e.target.value }))}
                    className="h-4 w-4 shrink-0 rounded-full border-0 bg-transparent p-0 cursor-pointer"
                    title="Change this class's color"
                  />
                  <button onClick={() => assignClass(id)} className="flex-1 text-left truncate">
                    <span className="text-muted-foreground text-xs mr-1">{i < 9 ? i + 1 : ""}</span>
                    {classes[id]}
                  </button>
                </div>
              ))}
              {sortedClassIds.length === 0 && (
                <p className="text-xs text-muted-foreground">Add a class below to start labeling.</p>
              )}
            </div>
            <div className="flex gap-1">
              <Input
                className="h-7 text-xs"
                placeholder="New class"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddClass()}
              />
              <Button size="icon" className="h-7 w-7 shrink-0" onClick={handleAddClass}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Button variant="outline" size="sm" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Prev
              </Button>
              <span className="text-xs text-muted-foreground truncate max-w-[160px]">{currentImage?.filename}</span>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  max={total}
                  value={jumpValue}
                  onChange={(e) => setJumpValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleJump()}
                  placeholder={`# 1-${total}`}
                  className="h-7 w-24 text-xs"
                />
                <Button variant="outline" size="sm" className="h-7" onClick={handleJump}>
                  Go
                </Button>
              </div>
              {currentIndex === total - 1 ? (
                <Button size="sm" onClick={handleDone}>
                  <Check className="h-4 w-4 mr-1" /> Finish
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={() => goTo(currentIndex + 1)}>
                  Next <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              )}
            </div>

            {currentImage && Object.keys(classes).length > 0 && (
              <AnnotationCanvas
                imageUrl={getImageUrl(name, currentImage.split, currentImage.filename)}
                boxes={boxes}
                classNames={classes}
                classColors={classColors}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onBoxesChange={setBoxes}
                pendingClassId={pendingClassId}
              />
            )}
            {Object.keys(classes).length === 0 && (
              <div className="border border-dashed border-border rounded-md p-12 text-center text-muted-foreground text-sm">
                Add at least one class before you can draw boxes.
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Boxes on this image ({boxes.length})</Label>
              {boxes.map((b) => (
                <div
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  className={cn(
                    "flex items-center justify-between px-2 py-1 rounded-md text-sm cursor-pointer border",
                    selectedId === b.id ? "border-foreground bg-accent/50" : "border-transparent hover:bg-accent/30"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: getClassColor(b.class_id) }} />
                    {classes[b.class_id] ?? `class_${b.class_id}`}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteBox(b.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} dataset={name} />
    </div>
  );
}

function ImportDialog({ open, onOpenChange, dataset }: { open: boolean; onOpenChange: (v: boolean) => void; dataset: string }) {
  const queryClient = useQueryClient();
  const [folderPath, setFolderPath] = useState("");
  const [split, setSplit] = useState("train");
  const [prefix, setPrefix] = useState("A");
  const [submitting, setSubmitting] = useState(false);

  const handleImport = async () => {
    if (!folderPath.trim()) {
      toast.error("Enter a folder path");
      return;
    }
    if (!prefix.trim()) {
      toast.error("Enter a prefix");
      return;
    }
    setSubmitting(true);
    try {
      const res = await importFolder(dataset, { folder_path: folderPath.trim(), split, prefix: prefix.toUpperCase() });
      toast.success(`Imported ${res.images_added} image(s)`);
      if (res.images_skipped > 0) toast.warning(`${res.images_skipped} file(s) skipped`);
      await queryClient.invalidateQueries({ queryKey: ["image-at", dataset] });
      await queryClient.invalidateQueries({ queryKey: ["dataset", dataset] });
      onOpenChange(false);
      setFolderPath("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import Images</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Local folder path</Label>
            <Input
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="C:\Users\me\Pictures\potholes"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Split</Label>
              <Select value={split} onValueChange={setSplit}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="train">train</SelectItem>
                  <SelectItem value="valid">valid</SelectItem>
                  <SelectItem value="test">test</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Prefix</Label>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value.toUpperCase())} maxLength={4} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={submitting}>
            {submitting ? "Importing..." : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
