import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { listImages } from "@/api/images";
import { ImageThumbnail } from "@/components/ImageThumbnail";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const SPLITS = ["train", "valid", "test"];

export function ImageGrid({ dataset }: { dataset: string }) {
  const [split, setSplit] = useState<string>("train");
  const [page, setPage] = useState(1);
  const pageSize = 60;

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["images", dataset, split, page],
    queryFn: () => listImages(dataset, split, page, pageSize),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Select
          value={split}
          onValueChange={(v) => {
            setSplit(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPLITS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {total > 0 ? `Showing ${rangeStart}–${rangeEnd} of ${total}` : "No images"}
          </span>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {[...Array(12)].map((_, i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <div className="text-sm text-muted-foreground">No images in this split.</div>
      )}

      <div className={`grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 ${isPlaceholderData ? "opacity-60" : ""}`}>
        {items.map((img) => (
          <ImageThumbnail key={img.filename} dataset={dataset} image={img} />
        ))}
      </div>
    </div>
  );
}
