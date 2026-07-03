import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getDataset } from "@/api/datasets";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export interface ClassFilterState {
  keep: boolean;
  name: string;
}

interface ClassFilterEditorProps {
  source: string;
  value: Record<string, ClassFilterState>;
  onChange: (value: Record<string, ClassFilterState>) => void;
}

/** Lets the user pick which classes from a source dataset to keep (and optionally rename) before
 * copying it in. Unchecked classes are dropped from the labels entirely — useful when a Roboflow
 * export has extra classes you don't actually want (e.g. only keeping 'reflective' as 'vest'). */
export function ClassFilterEditor({ source, value, onChange }: ClassFilterEditorProps) {
  const { data: detail, isLoading } = useQuery({
    queryKey: ["dataset", source],
    queryFn: () => getDataset(source),
    enabled: !!source,
  });

  useEffect(() => {
    if (!detail) return;
    const next: Record<string, ClassFilterState> = {};
    for (const [id, name] of Object.entries(detail.classes)) {
      next[id] = value[id] ?? { keep: true, name };
    }
    onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  if (!source) return null;
  if (isLoading) return <Skeleton className="h-20" />;
  if (!detail || Object.keys(detail.classes).length === 0) return null;

  const entries = Object.entries(detail.classes).sort((a, b) => Number(a[0]) - Number(b[0]));
  const keptCount = Object.values(value).filter((v) => v.keep).length;

  return (
    <div className="space-y-2">
      <Label>Classes to include ({keptCount} of {entries.length} kept)</Label>
      <div className="border border-border rounded-md divide-y divide-border">
        {entries.map(([id, originalName]) => {
          const state = value[id] ?? { keep: true, name: originalName };
          return (
            <div key={id} className="flex items-center gap-3 px-3 py-2">
              <Checkbox
                checked={state.keep}
                onCheckedChange={(checked) =>
                  onChange({ ...value, [id]: { ...state, keep: checked === true } })
                }
              />
              <span className="text-xs text-muted-foreground w-6 shrink-0">#{id}</span>
              <Input
                value={state.name}
                disabled={!state.keep}
                onChange={(e) => onChange({ ...value, [id]: { ...state, name: e.target.value } })}
                className="h-8"
              />
              {originalName !== state.name && state.keep && (
                <span className="text-xs text-muted-foreground shrink-0">was "{originalName}"</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Unchecked classes are dropped — their boxes are removed from the copied labels entirely, not just hidden.
      </p>
    </div>
  );
}
