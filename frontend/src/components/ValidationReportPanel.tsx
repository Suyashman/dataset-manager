import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, ChevronRight, Info, ScanSearch, Trash2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteOrphanLabel } from "@/api/annotation";
import type { FlaggedItem } from "@/types/annotation";
import type { ValidationIssue, ValidationReport } from "@/types/stats";

const severityIcon = { error: XCircle, warning: AlertTriangle, info: Info } as const;
const severityColor = { error: "text-destructive", warning: "text-yellow-500", info: "text-muted-foreground" } as const;

// Checks that point at a real image file worth opening in the editor. duplicate_class_names
// isn't file-specific, duplicate_filenames only gives a stem (extension/split ambiguous), and
// missing_images points at an orphan label with no image to show — all three are handled
// differently below instead of going into the reviewable queue.
const REVIEWABLE_CHECKS = new Set(["missing_labels", "empty_label_files", "corrupted_images", "invalid_label_lines"]);

// missing_labels/corrupted_images report the image's own filename in `file`. empty_label_files
// and invalid_label_lines report the *label's* filename instead (`file` ends in .txt) — the
// backend resolves the matching image name separately into `details.image_file` for those.
function imageFilenameFor(issue: ValidationIssue): string | null {
  if (issue.check === "empty_label_files" || issue.check === "invalid_label_lines") {
    return (issue.details?.image_file as string | undefined) ?? null;
  }
  return issue.file ?? null;
}

function groupByCheck(issues: ValidationIssue[]) {
  const groups: Record<string, ValidationIssue[]> = {};
  for (const issue of issues) {
    groups[issue.check] = groups[issue.check] || [];
    groups[issue.check].push(issue);
  }
  return groups;
}

// Merges every issue that resolves to a single image into one queue entry (an image can have
// more than one flag, e.g. an invalid class id AND an out-of-bounds box), then expands
// duplicate_images groups into one entry per file in the group.
function buildFlaggedQueue(issues: ValidationIssue[]): FlaggedItem[] {
  const byKey = new Map<string, FlaggedItem>();
  const add = (split: string, filename: string, reason: string) => {
    const key = `${split}::${filename}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
    } else {
      byKey.set(key, { split, filename, reasons: [reason] });
    }
  };

  for (const issue of issues) {
    if (issue.check === "duplicate_images") {
      const files = (issue.details?.files as string[] | undefined) ?? [];
      for (const entry of files) {
        const [split, ...rest] = entry.split("/");
        const filename = rest.join("/");
        const others = files.filter((f) => f !== entry);
        add(split, filename, `Near-duplicate of ${others.join(", ")}`);
      }
      continue;
    }
    const filename = imageFilenameFor(issue);
    if (!REVIEWABLE_CHECKS.has(issue.check) || !issue.split || !filename) continue;
    const reason = issue.line_number ? `Line ${issue.line_number}: ${issue.message}` : issue.message;
    add(issue.split, filename, reason);
  }

  return Array.from(byKey.values());
}

function IssueRow({
  issue,
  onReview,
}: {
  issue: ValidationIssue;
  onReview: (item: FlaggedItem) => void;
}) {
  const filename = imageFilenameFor(issue);
  const reviewable = REVIEWABLE_CHECKS.has(issue.check) && issue.split && filename;
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        {issue.split ? `[${issue.split}] ` : ""}
        {issue.file ?? ""}
        {issue.line_number ? `:${issue.line_number}` : ""} — {issue.message}
      </div>
      {reviewable && (
        <Button
          variant="ghost"
          size="xs"
          className="shrink-0 h-6"
          onClick={() =>
            onReview({
              split: issue.split!,
              filename: filename!,
              reasons: [issue.line_number ? `Line ${issue.line_number}: ${issue.message}` : issue.message],
            })
          }
        >
          <ScanSearch className="h-3 w-3 mr-1" /> Review
        </Button>
      )}
    </div>
  );
}

function OrphanLabelRow({ dataset, issue, onDeleted }: { dataset: string; issue: ValidationIssue; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => {
    if (!issue.split || !issue.file) return;
    setDeleting(true);
    try {
      await deleteOrphanLabel(dataset, issue.split, issue.file);
      toast.success(`Deleted orphan label '${issue.file}'`);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete label");
    } finally {
      setDeleting(false);
    }
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        {issue.split ? `[${issue.split}] ` : ""}
        {issue.file ?? ""} — {issue.message}
      </div>
      <Button variant="ghost" size="xs" className="shrink-0 h-6 text-destructive" onClick={handleDelete} disabled={deleting}>
        <Trash2 className="h-3 w-3 mr-1" /> {deleting ? "Deleting..." : "Delete label"}
      </Button>
    </div>
  );
}

function CheckGroup({
  dataset,
  check,
  issues,
  onReview,
  onReviewAll,
  onOrphanDeleted,
}: {
  dataset: string;
  check: string;
  issues: ValidationIssue[];
  onReview: (item: FlaggedItem) => void;
  onReviewAll: (items: FlaggedItem[]) => void;
  onOrphanDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const Icon = severityIcon[issues[0].severity];
  const isOrphanLabels = check === "missing_images";
  const groupQueue = isOrphanLabels ? [] : buildFlaggedQueue(issues);

  return (
    <div className="border border-border rounded-md">
      <div className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent/30">
        <button className="flex items-center gap-2 flex-1 text-left" onClick={() => setOpen((o) => !o)}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Icon className={`h-4 w-4 ${severityColor[issues[0].severity]}`} />
          {check.replace(/_/g, " ")}
        </button>
        <div className="flex items-center gap-2">
          {groupQueue.length > 0 && (
            <Button variant="ghost" size="xs" className="h-6" onClick={() => onReviewAll(groupQueue)}>
              <ScanSearch className="h-3 w-3 mr-1" /> Review all
            </Button>
          )}
          <Badge variant="secondary">{issues.length}</Badge>
        </div>
      </div>
      {open && (
        <div className="px-3 pb-2 max-h-48 overflow-y-auto text-xs text-muted-foreground space-y-1.5">
          {issues.slice(0, 100).map((issue, i) =>
            isOrphanLabels ? (
              <OrphanLabelRow key={i} dataset={dataset} issue={issue} onDeleted={onOrphanDeleted} />
            ) : (
              <IssueRow key={i} issue={issue} onReview={onReview} />
            )
          )}
        </div>
      )}
    </div>
  );
}

export function ValidationReportPanel({
  dataset,
  report,
  refreshing,
  onRefresh,
}: {
  dataset: string;
  report: ValidationReport;
  refreshing?: boolean;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const groups = groupByCheck(report.issues);
  const checks = Object.keys(groups);

  const openQueue = (items: FlaggedItem[]) => {
    if (items.length === 0) return;
    navigate(`/annotate/${encodeURIComponent(dataset)}`, { state: { flaggedQueue: items } });
  };

  // The numbers below can be a moment stale right after edits/deletes elsewhere — the dataset's
  // file listing changed, so a fresh (uncached) validation pass has to run in the background.
  // This just says so instead of silently showing a possibly-outdated count.
  const refreshNotice = refreshing && (
    <div className="text-xs text-muted-foreground animate-pulse">Rechecking dataset for changes…</div>
  );

  if (checks.length === 0) {
    return (
      <div className="space-y-2">
        {refreshNotice}
        <div className="text-sm text-muted-foreground">No validation issues found. Dataset looks clean.</div>
      </div>
    );
  }

  const allFlagged = buildFlaggedQueue(report.issues);

  return (
    <div className="space-y-3">
      {refreshNotice}
      {allFlagged.length > 0 && (
        <Button size="sm" onClick={() => openQueue(allFlagged)}>
          <ScanSearch className="h-4 w-4 mr-1" /> Review all {allFlagged.length} flagged image{allFlagged.length === 1 ? "" : "s"}
        </Button>
      )}
      <div className="space-y-2">
        {checks.map((check) => (
          <CheckGroup
            key={check}
            dataset={dataset}
            check={check}
            issues={groups[check]}
            onReview={(item) => openQueue([item])}
            onReviewAll={openQueue}
            onOrphanDeleted={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}
