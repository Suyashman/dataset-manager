import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Info, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ValidationIssue, ValidationReport } from "@/types/stats";

const severityIcon = { error: XCircle, warning: AlertTriangle, info: Info } as const;
const severityColor = { error: "text-destructive", warning: "text-yellow-500", info: "text-muted-foreground" } as const;

function groupByCheck(issues: ValidationIssue[]) {
  const groups: Record<string, ValidationIssue[]> = {};
  for (const issue of issues) {
    groups[issue.check] = groups[issue.check] || [];
    groups[issue.check].push(issue);
  }
  return groups;
}

function CheckGroup({ check, issues }: { check: string; issues: ValidationIssue[] }) {
  const [open, setOpen] = useState(false);
  const Icon = severityIcon[issues[0].severity];

  return (
    <div className="border border-border rounded-md">
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent/30"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Icon className={`h-4 w-4 ${severityColor[issues[0].severity]}`} />
          {check.replace(/_/g, " ")}
        </span>
        <Badge variant="secondary">{issues.length}</Badge>
      </button>
      {open && (
        <div className="px-3 pb-2 max-h-48 overflow-y-auto text-xs text-muted-foreground space-y-1">
          {issues.slice(0, 100).map((issue, i) => (
            <div key={i}>
              {issue.split ? `[${issue.split}] ` : ""}
              {issue.file ?? ""}
              {issue.line_number ? `:${issue.line_number}` : ""} — {issue.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ValidationReportPanel({ report }: { report: ValidationReport }) {
  const groups = groupByCheck(report.issues);
  const checks = Object.keys(groups);

  if (checks.length === 0) {
    return <div className="text-sm text-muted-foreground">No validation issues found. Dataset looks clean.</div>;
  }

  return (
    <div className="space-y-2">
      {checks.map((check) => (
        <CheckGroup key={check} check={check} issues={groups[check]} />
      ))}
    </div>
  );
}
