import { api } from "@/api/client";
import type { ImageListResponse, LabelResponse } from "@/types/image";

export const listImages = (name: string, split?: string, page = 1, pageSize = 60) => {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
  if (split) params.set("split", split);
  return api.get<ImageListResponse>(`/datasets/${encodeURIComponent(name)}/images?${params}`);
};

export const getImageUrl = (name: string, split: string, filename: string) =>
  `/api/datasets/${encodeURIComponent(name)}/images/${split}/${encodeURIComponent(filename)}`;

export const getLabel = (name: string, split: string, filename: string) =>
  api.get<LabelResponse>(`/datasets/${encodeURIComponent(name)}/labels/${split}/${encodeURIComponent(filename)}`);
