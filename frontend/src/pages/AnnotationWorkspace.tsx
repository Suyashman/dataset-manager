import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Check, ChevronLeft, ChevronRight, Plus, Trash2, Upload } from "lucide-react";
import { getDataset } from "@/api/datasets";
import { listImages, getImageUrl, getLabel } from "@/api/images";
import { addClass, deleteImage, importFolder, saveBoxes } from "@/api/annotation";
import { AnnotationCanvas, newBoxId, type EditableBox } from "@/components/AnnotationCanvas";
import { classColor } from "@/lib/yoloMath";
import type { FlaggedItem } from "@/types/annotation";
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
  const location = useLocation();
  const queryClient = useQueryClient();

  // Opened from the Validation tab's "Review" action: iterate this curated list of already-
  // flagged images instead of paginating the whole dataset.
  const flaggedQueue = (location.state as { flaggedQueue?: FlaggedItem[] } | null)?.flaggedQueue;
  const isFlaggedMode = !!flaggedQueue && flaggedQueue.length > 0;
  const [queue, setQueue] = useState<FlaggedItem[]>(flaggedQueue ?? []);

  const { data: detail } = useQuery({ queryKey: ["dataset", name], queryFn: () => getDataset(name) });

  const classes: Record<number, string> = {};
  if (detail) for (const [k, v] of Object.entries(detail.classes)) classes[Number(k)] = v;
  const sortedClassIds = Object.keys(classes).map(Number).sort((a, b) => a - b);

  const [classColors, setClassColors] = useState<Record<number, string>>({});
  const getClassColor = (id: number) => classColors[id] ?? classColor(id);

  // Position is remembered per-dataset so leaving mid-review and coming back resumes here —
  // but a flagged-image queue always starts at the top, it's a fresh curated list each time.
  const [currentIndex, setCurrentIndex] = useState(() => {
    if (isFlaggedMode) return 0;
    const saved = Number(localStorage.getItem(`annotate-position:${name}`));
    return Number.isFinite(saved) && saved > 0 ? saved : 0;
  });
  const [jumpValue, setJumpValue] = useState("");

  useEffect(() => {
    if (!isFlaggedMode) localStorage.setItem(`annotate-position:${name}`, String(currentIndex));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, currentIndex, isFlaggedMode]);

  // One image fetched at a time via page_size=1 so this scales to datasets with thousands of
  // images instead of preloading a thumbnail list up front. Skipped entirely in flagged mode,
  // where `queue` is already the full list of images to show.
  const { data: pageData, isLoading: imageLoading } = useQuery({
    queryKey: ["image-at", name, currentIndex],
    queryFn: () => listImages(name, undefined, currentIndex + 1, 1),
    placeholderData: keepPreviousData,
    enabled: !isFlaggedMode,
  });
  const currentImage = isFlaggedMode ? queue[currentIndex] : pageData?.items[0];
  const total = isFlaggedMode ? queue.length : pageData?.total ?? 0;

  // A position saved from a previously larger dataset (or a queue that just lost an entry to
  // deletion) can point past the end — snap back to the new last item.
  useEffect(() => {
    if (total > 0 && currentIndex >= total) setCurrentIndex(total - 1);
  }, [total, currentIndex]);

  const { data: label } = useQuery({
    queryKey: ["label", name, currentImage?.split, currentImage?.filename],
    queryFn: () => getLabel(name, currentImage!.split, currentImage!.filename),
    enabled: !!currentImage,
    retry: false,
  });

  const [boxes, setBoxes] = useState<EditableBox[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingClassId, setPendingClassId] = useState(0);
  const [newClassName, setNewClassName] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [importOpen, setImportOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingImage, setDeletingImage] = useState(false);

  const skipNextSaveRef = useRef(false);
  // Keyed by "split::filename" rather than a single slot so edits to two different images
  // (e.g. edit, jump away before the debounce fires, edit again) queue independently instead
  // of one clobbering the other.
  type PendingSave = { split: string; filename: string; boxes: EditableBox[] };
  const pendingSavesRef = useRef<Map<string, PendingSave>>(new Map());
  const saveTimerRef = useRef<number | null>(null);
  const retryTimerRef = useRef<number | null>(null);

  // Guards against showing one image's boxes over a different image. `label` only updates once
  // its fetch resolves, but `boxes` state has no reason to wait for that — left alone, whatever
  // was on screen for the *previous* image stays visible (attributed to the new one) until the
  // fetch completes. Clearing to [] the instant the image identity changes means the canvas is
  // honestly empty while loading instead of silently wrong.
  const currentImageKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = currentImage ? `${currentImage.split}::${currentImage.filename}` : null;
    if (key === currentImageKeyRef.current) return;
    currentImageKeyRef.current = key;
    skipNextSaveRef.current = true;
    setBoxes([]);
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentImage?.split, currentImage?.filename]);

  useEffect(() => {
    if (!label) return;
    // Only apply this label's boxes if it's still for the currently-displayed image — an
    // in-flight fetch for a since-abandoned image (e.g. rapid delete-delete-delete) resolving
    // late must not repopulate boxes for whatever is on screen now.
    if (currentImageKeyRef.current !== (currentImage ? `${currentImage.split}::${currentImage.filename}` : null)) return;
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

  // Fires every pending save, in parallel. Entries only leave the queue once their PUT
  // actually succeeds — a failed save stays queued (keyed by image) so the very next trigger
  // (another edit, a navigation, unmount, or the retry timer below) resends it instead of the
  // edit silently vanishing.
  const flushSave = () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    const entries = Array.from(pendingSavesRef.current.entries());
    if (entries.length === 0) return Promise.resolve();

    setSaveState("saving");
    return Promise.all(
      entries.map(([key, entry]) =>
        saveBoxes(
          name,
          entry.split,
          entry.filename,
          entry.boxes.map(({ class_id, x_center, y_center, width, height }) => ({ class_id, x_center, y_center, width, height }))
        )
          .then(() => {
            // Only clear this key if it's still the same entry we just saved — a newer edit
            // to the same image made while this request was in flight must not be dropped.
            if (pendingSavesRef.current.get(key) === entry) pendingSavesRef.current.delete(key);
            return true;
          })
          .catch(() => false)
      )
    ).then((results) => {
      queryClient.invalidateQueries({ queryKey: ["image-at", name] });
      queryClient.invalidateQueries({ queryKey: ["validation", name] });
      queryClient.invalidateQueries({ queryKey: ["stats", name] });
      const anyFailed = results.some((ok) => !ok);
      if (anyFailed) {
        toast.error("Failed to save some annotations — will retry automatically");
        setSaveState("error");
        retryTimerRef.current = window.setTimeout(flushSave, 3000);
      } else {
        setSaveState(pendingSavesRef.current.size > 0 ? "dirty" : "saved");
      }
    });
  };

  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (!currentImage) return;
    // In flagged-review mode `currentImage` is already known at mount (it comes from the local
    // queue, not a fetch), but `boxes` still starts as `[]` until the real label loads — without
    // this guard, that stale initial value would get scheduled for save before the actual
    // annotations ever arrive, silently overwriting a real label with an empty one.
    if (!label) return;
    const key = `${currentImage.split}::${currentImage.filename}`;
    pendingSavesRef.current.set(key, { split: currentImage.split, filename: currentImage.filename, boxes });
    setSaveState("dirty");
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushSave, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes]);

  useEffect(() => () => { flushSave(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Closing the tab, refreshing, or navigating outside the app entirely would otherwise
  // silently drop whatever hasn't flushed yet — warn instead of losing the edit.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pendingSavesRef.current.size > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      // While the delete-image confirm dialog is open, Enter confirms it (Escape already
      // closes it via Radix's built-in handling) — keeps the whole delete flow keyboard-only
      // without removing the one safety check against an accidental key press.
      if (deleteOpen) {
        if (e.key === "Enter") {
          e.preventDefault();
          handleDeleteImage();
        }
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedId) {
          setBoxes((prev) => prev.filter((b) => b.id !== selectedId));
          setSelectedId(null);
        } else if (currentImage) {
          setDeleteOpen(true);
        }
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
  }, [selectedId, currentIndex, total, sortedClassIds.join(","), deleteOpen, currentImage]);

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

  const saveStatusText =
    saveState === "saving" ? "Saving…"
    : saveState === "dirty" ? "Unsaved changes"
    : saveState === "error" ? "Save failed — retrying…"
    : saveState === "saved" ? "All changes saved"
    : "";

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

  const handleDeleteImage = async () => {
    if (!currentImage) return;
    setDeletingImage(true);
    try {
      // Drop any queued save for this image first — it's about to stop existing, so a stray
      // retry landing after the delete must not resurrect its label file.
      pendingSavesRef.current.delete(`${currentImage.split}::${currentImage.filename}`);
      await deleteImage(name, currentImage.split, currentImage.filename);
      toast.success(`Deleted ${currentImage.filename}`);
      if (isFlaggedMode) {
        setQueue((prev) => prev.filter((_, i) => i !== currentIndex));
      } else {
        await queryClient.invalidateQueries({ queryKey: ["image-at", name] });
      }
      await queryClient.invalidateQueries({ queryKey: ["dataset", name] });
      await queryClient.invalidateQueries({ queryKey: ["validation", name] });
      await queryClient.invalidateQueries({ queryKey: ["stats", name] });
      setDeleteOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete image");
    } finally {
      setDeletingImage(false);
    }
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
            {total > 0
              ? `${isFlaggedMode ? "Flagged image" : "Image"} ${currentIndex + 1} of ${total}`
              : imageLoading && !isFlaggedMode
              ? "Loading…"
              : isFlaggedMode
              ? "No flagged images left in this review queue"
              : "No images yet"}
            {saveStatusText && (
              <span className={cn("ml-1", saveState === "error" && "text-destructive")}>· {saveStatusText}</span>
            )}
          </p>
        </div>
        {!isFlaggedMode && (
          <Button size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-1" /> Import Images
          </Button>
        )}
      </div>

      {!isFlaggedMode && imageLoading && !pageData ? (
        <Skeleton className="h-96 w-full" />
      ) : total === 0 ? (
        <div className="border border-dashed border-border rounded-md p-12 text-center text-muted-foreground">
          {isFlaggedMode
            ? "Every flagged image has been reviewed. Nothing left in this queue."
            : 'No images yet. Click "Import Images" to bring in a folder from your computer.'}
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
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive shrink-0"
                title="Delete this image (Delete/Backspace, then Enter to confirm)"
                onClick={() => setDeleteOpen(true)}
                disabled={!currentImage}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
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

            {isFlaggedMode && currentImage && "reasons" in currentImage && (
              <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-700 dark:text-yellow-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{(currentImage as FlaggedItem).reasons.join(" · ")}</span>
              </div>
            )}

            {currentImage && Object.keys(classes).length > 0 && (
              <>
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
                <p className="text-xs text-muted-foreground">
                  Hold <kbd className="px-1 py-0.5 rounded border border-border bg-muted text-[0.7rem]">Shift</kbd> while
                  drawing to start a new box on top of an existing one, instead of dragging it.
                </p>
              </>
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

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {currentImage?.filename}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Permanently removes this image and its label file from the dataset on disk. This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deletingImage}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteImage} disabled={deletingImage}>
              {deletingImage ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
