import { useQuery } from "@tanstack/react-query";
import { getSam3Status } from "@/api/sam3";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { classColor } from "@/lib/yoloMath";

/** Parses the sidecar's comma gate format into one value per class. */
function parseGate(spec: string, n: number, fallback: number): number[] {
  const v = spec
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((x) => !Number.isNaN(x));
  if (!v.length) return Array(n).fill(fallback);
  if (v.length === 1) return Array(n).fill(v[0]);
  return [...v, ...Array(n).fill(fallback)].slice(0, n);
}

export function Sam3GatePanel({
  run,
  accept,
  reject,
  onGateChange,
}: {
  run: string;
  accept: string;
  reject: string;
  onGateChange: (accept: string, reject: string) => void;
}) {
  const { data: status } = useQuery({
    queryKey: ["sam3-status", run, accept, reject],
    queryFn: () => getSam3Status(run, accept, reject),
    retry: false,
  });

  if (!status) return null;

  const n = status.classes.length || 1;
  const accVals = parseGate(accept, n, 0.6);
  const rejVals = parseGate(reject, n, 0.4);

  const setOne = (which: "accept" | "reject", idx: number, value: string) => {
    const vals = which === "accept" ? [...accVals] : [...rejVals];
    vals[idx] = Number(value);
    const spec = vals.map((v) => (Number.isNaN(v) ? 0 : v)).join(",");
    if (which === "accept") onGateChange(spec, reject);
    else onGateChange(accept, spec);
  };

  const maxHist = Math.max(1, ...status.hist);
  const span = status.hist_hi - status.hist_lo;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Confidence gate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            The measured F1-optimal threshold ranged 0.70 (goggles) to 0.85 (person) on a real PPE
            set, so one global number gives up either precision or recall. Moving a threshold never
            re-runs the model — every instance scoring ≥0.25 is already stored, so the gate is just
            a filter over them.
          </p>

          {status.measured && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground">
                Measured gate available: <span className="font-mono">{status.measured.source}</span>
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                onClick={() => {
                  const spec = status.classes
                    .map((c) => status.measured?.accept[String(c.id)] ?? 0.6)
                    .join(",");
                  onGateChange(spec, reject);
                }}
              >
                Use measured
              </Button>
            </div>
          )}

          <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
            <Label className="text-xs">Class</Label>
            <Label className="text-xs w-24">Accept ≥</Label>
            <Label className="text-xs w-24">Reject &lt;</Label>
            {status.classes.map((c, i) => (
              <GateRow
                key={c.id}
                name={c.name}
                colorId={c.id}
                accepted={c.accepted}
                review={c.review}
                acceptValue={accVals[i]}
                rejectValue={rejVals[i]}
                onAccept={(v) => setOne("accept", i, v)}
                onReject={(v) => setOne("reject", i, v)}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span>
              <span className="text-muted-foreground">accepted</span> {status.buckets.accepted}
            </span>
            <span>
              <span className="text-muted-foreground">to review</span> {status.buckets.review}
            </span>
            <span>
              <span className="text-muted-foreground">dropped</span> {status.buckets.dropped}
            </span>
            <span>
              <span className="text-muted-foreground">rejected</span> {status.buckets.rejected}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Score distribution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex h-28 items-end gap-1">
            {status.hist.map((count, i) => {
              const binLo = status.hist_lo + (span * i) / status.hist.length;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-t bg-primary/70"
                  style={{ height: `${(count / maxHist) * 100}%`, minHeight: count ? 2 : 0 }}
                  title={`${binLo.toFixed(2)}+ · ${count} instances`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{status.hist_lo.toFixed(2)}</span>
            <span>{status.hist_hi.toFixed(2)}</span>
          </div>
          {status.split_parts > 0 && (
            <p className="text-xs text-muted-foreground">
              {status.split_parts} instance{status.split_parts === 1 ? " has" : "s have"} disjoint
              parts. YOLO-seg keeps only the largest blob — that is a format limit being reported,
              not a bug.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per folder</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-1">Folder</th>
                <th className="pb-1">Images</th>
                <th className="pb-1">Instances</th>
                <th className="pb-1">Accepted</th>
              </tr>
            </thead>
            <tbody>
              {status.folders.map((f) => (
                <tr key={f.name} className="border-t border-border">
                  <td className="py-1 font-mono text-xs">{f.name}</td>
                  <td className="py-1">{f.images}</td>
                  <td className="py-1">{f.instances}</td>
                  <td className="py-1">{f.accepted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function GateRow({
  name,
  colorId,
  accepted,
  review,
  acceptValue,
  rejectValue,
  onAccept,
  onReject,
}: {
  name: string;
  colorId: number;
  accepted: number;
  review: number;
  acceptValue: number;
  rejectValue: number;
  onAccept: (v: string) => void;
  onReject: (v: string) => void;
}) {
  return (
    <>
      <span className="flex items-center gap-2 text-sm">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: classColor(colorId) }}
        />
        {name}
        <span className="text-xs text-muted-foreground">
          {accepted} accepted · {review} to review
        </span>
      </span>
      <Input
        type="number"
        step="0.05"
        min="0"
        max="1"
        className="h-8 w-24"
        value={acceptValue}
        onChange={(e) => onAccept(e.target.value)}
      />
      <Input
        type="number"
        step="0.05"
        min="0"
        max="1"
        className="h-8 w-24"
        value={rejectValue}
        onChange={(e) => onReject(e.target.value)}
      />
    </>
  );
}
