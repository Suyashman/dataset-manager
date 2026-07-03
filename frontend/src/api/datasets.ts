import { api } from "@/api/client";
import type {
  CreateDatasetRequest,
  DatasetDetail,
  DatasetSummary,
  MergeDatasetRequest,
  MergeMultiRequest,
} from "@/types/dataset";

export const listDatasets = () => api.get<DatasetSummary[]>("/datasets");
export const listDatasetNames = () => api.get<string[]>("/datasets/names");
export const getDataset = (name: string) => api.get<DatasetDetail>(`/datasets/${encodeURIComponent(name)}`);
export const createDataset = (req: CreateDatasetRequest) => api.post<{ job_id: string }>("/datasets/create", req);
export const mergeDataset = (req: MergeDatasetRequest) => api.post<{ job_id: string }>("/datasets/merge", req);
export const mergeMulti = (req: MergeMultiRequest) => api.post<{ job_id: string }>("/datasets/merge-multi", req);
export const deleteDataset = (name: string) => api.del(`/datasets/${encodeURIComponent(name)}?confirm=true`);
