import { Link } from "react-router-dom";
import { Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBytes, formatDate } from "@/lib/format";
import type { DatasetSummary } from "@/types/dataset";

export function DatasetCard({ dataset }: { dataset: DatasetSummary }) {
  return (
    <Link to={`/datasets/${encodeURIComponent(dataset.name)}`}>
      <Card className="hover:border-primary/50 transition-colors h-full">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            {dataset.name}
          </CardTitle>
          <Badge variant="secondary">{dataset.num_classes} classes</Badge>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <div>{dataset.total_images} images total</div>
          <div className="flex gap-3 text-xs">
            {Object.entries(dataset.splits).map(([split, count]) => (
              <span key={split}>
                {split}: {count}
              </span>
            ))}
          </div>
          <div className="text-xs pt-1">
            {formatBytes(dataset.size_bytes)} · updated {formatDate(dataset.last_modified)}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
