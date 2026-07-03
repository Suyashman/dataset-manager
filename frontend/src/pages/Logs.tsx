import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

interface LogEntry {
  timestamp: string;
  level: string;
  category: string;
  dataset: string | null;
  message: string;
  details: Record<string, unknown>;
}

const levelVariant: Record<string, "default" | "destructive" | "secondary"> = {
  INFO: "secondary",
  WARNING: "default",
  ERROR: "destructive",
};

export function Logs() {
  const { data: dates } = useQuery({
    queryKey: ["log-dates"],
    queryFn: () => api.get<{ dates: string[] }>("/logs"),
  });
  const [date, setDate] = useState<string>("");

  const selectedDate = date || dates?.dates[0] || "";

  const { data: log } = useQuery({
    queryKey: ["log", selectedDate],
    queryFn: () => api.get<{ date: string; entries: LogEntry[] }>(`/logs/${selectedDate}?lines=500`),
    enabled: !!selectedDate,
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Logs</h1>
      <p className="text-muted-foreground mb-4">Activity log: dataset creation, merges, renames, and errors.</p>

      <Select value={selectedDate} onValueChange={setDate}>
        <SelectTrigger className="w-48 mb-4">
          <SelectValue placeholder="Select date" />
        </SelectTrigger>
        <SelectContent>
          {(dates?.dates ?? []).map((d) => (
            <SelectItem key={d} value={d}>
              {d}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="space-y-2">
        {(log?.entries ?? []).length === 0 && <div className="text-sm text-muted-foreground">No log entries.</div>}
        {[...(log?.entries ?? [])].reverse().map((entry, i) => (
          <div key={i} className="border border-border rounded-md px-3 py-2 text-sm flex items-start gap-2">
            <Badge variant={levelVariant[entry.level] ?? "secondary"}>{entry.level}</Badge>
            <div>
              <div>
                <span className="font-medium">{entry.category}</span>
                {entry.dataset && <span className="text-muted-foreground"> · {entry.dataset}</span>}
              </div>
              <div className="text-muted-foreground">{entry.message}</div>
              <div className="text-xs text-muted-foreground">{entry.timestamp}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
