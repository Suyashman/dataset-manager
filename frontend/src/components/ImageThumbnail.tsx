import { Link } from "react-router-dom";
import { getImageUrl } from "@/api/images";
import { Badge } from "@/components/ui/badge";
import type { ImageInfo } from "@/types/image";

export function ImageThumbnail({ dataset, image }: { dataset: string; image: ImageInfo }) {
  return (
    <Link
      to={`/datasets/${encodeURIComponent(dataset)}/images/${image.split}/${encodeURIComponent(image.filename)}`}
      className="group relative block aspect-square overflow-hidden rounded-md border border-border bg-muted"
    >
      <img
        src={getImageUrl(dataset, image.split, image.filename)}
        alt={image.filename}
        loading="lazy"
        className="h-full w-full object-cover transition-transform group-hover:scale-105"
      />
      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1.5 py-1 text-[10px] text-white truncate flex justify-between">
        <span className="truncate">{image.filename}</span>
        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
          {image.box_count}
        </Badge>
      </div>
      {!image.has_label && (
        <Badge variant="destructive" className="absolute top-1 right-1 h-4 px-1 text-[10px]">
          no label
        </Badge>
      )}
    </Link>
  );
}
