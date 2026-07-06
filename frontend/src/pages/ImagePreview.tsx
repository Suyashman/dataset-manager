import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { ApiError } from "@/api/client";
import { getImageUrl, getLabel } from "@/api/images";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BBoxOverlayCanvas } from "@/components/BBoxOverlayCanvas";
import { LabelRawPanel } from "@/components/LabelRawPanel";
import { Skeleton } from "@/components/ui/skeleton";

export function ImagePreview() {
  const { name = "", split = "", filename = "" } = useParams();

  const { data: label, isLoading, isError, error } = useQuery({
    queryKey: ["label", name, split, filename],
    queryFn: () => getLabel(name, split, filename),
    retry: false,
  });

  const imageUrl = getImageUrl(name, split, filename);
  const [resolution, setResolution] = useState<[number, number] | null>(null);

  return (
    <div>
      <Link to={`/datasets/${encodeURIComponent(name)}`}>
        <Button variant="ghost" size="sm" className="mb-4 -ml-2">
          <ArrowLeft className="h-4 w-4 mr-1" /> Back to {name}
        </Button>
      </Link>

      <div className="flex items-center gap-2 mb-4">
        <h1 className="text-xl font-semibold">{filename}</h1>
        <Badge variant="secondary">{split}</Badge>
        {resolution && <Badge variant="outline">{resolution[0]} × {resolution[1]}</Badge>}
      </div>

      {isError ? (
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : "This image could not be loaded."}
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          <div>
            {isLoading || !label ? (
              <Skeleton className="h-96 w-full" />
            ) : (
              <BBoxOverlayCanvas
                imageUrl={imageUrl}
                boxes={label.boxes}
                onResolution={(w, h) => setResolution([w, h])}
              />
            )}
          </div>
          <div>{label && <LabelRawPanel label={label} />}</div>
        </div>
      )}
    </div>
  );
}
