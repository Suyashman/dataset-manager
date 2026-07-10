import { api } from "@/api/client";
import type { Box, ImportFolderRequest, ImportFolderResponse } from "@/types/annotation";

export const createEmptyDataset = (name: string) =>
  api.post<{ created: boolean; name: string }>("/annotation/create-empty", { name });

export const createFromReference = (source: string, destination: string) =>
  api.post<{ created: boolean; name: string }>("/annotation/create-from-reference", { source, destination });

export const importFolder = (dataset: string, req: ImportFolderRequest) =>
  api.post<ImportFolderResponse>(`/annotation/${encodeURIComponent(dataset)}/import-folder`, req);

export const addClass = (dataset: string, name: string) =>
  api.post<{ class_id: number; name: string }>(`/annotation/${encodeURIComponent(dataset)}/classes`, { name });

export const saveBoxes = (dataset: string, split: string, filename: string, boxes: Box[]) =>
  api.put<{ saved: boolean }>(
    `/annotation/${encodeURIComponent(dataset)}/${split}/${encodeURIComponent(filename)}/boxes`,
    { boxes }
  );

export const deleteImage = (dataset: string, split: string, filename: string) =>
  api.del<{ deleted: boolean; filename: string; had_label: boolean }>(
    `/annotation/${encodeURIComponent(dataset)}/${split}/${encodeURIComponent(filename)}`
  );

export const deleteOrphanLabel = (dataset: string, split: string, filename: string) =>
  api.del<{ deleted: boolean; filename: string }>(
    `/annotation/${encodeURIComponent(dataset)}/${split}/orphan-label/${encodeURIComponent(filename)}`
  );
