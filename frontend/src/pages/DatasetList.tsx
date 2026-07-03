import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listDatasets } from "@/api/datasets";
import { DatasetCard } from "@/components/DatasetCard";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export function DatasetList() {
  const { data, isLoading } = useQuery({ queryKey: ["datasets"], queryFn: listDatasets });
  const [filter, setFilter] = useState("");

  const filtered = (data ?? []).filter((d) => d.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Datasets</h1>
      <p className="text-muted-foreground mb-4">All datasets found under the datasets/ folder.</p>
      <Input
        placeholder="Filter by name..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="max-w-sm mb-6"
      />
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}
      {!isLoading && filtered.length === 0 && (
        <div className="text-muted-foreground text-sm">
          No datasets found. Place a YOLO-formatted dataset folder under <code>datasets/</code> to get started.
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((d) => (
          <DatasetCard key={d.name} dataset={d} />
        ))}
      </div>
    </div>
  );
}
