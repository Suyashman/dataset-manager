import { api } from "@/api/client";
import type { DatasetStats, ValidationReport } from "@/types/stats";

export const getStats = (name: string) => api.get<DatasetStats>(`/datasets/${encodeURIComponent(name)}/stats`);
export const getValidation = (name: string) => api.get<ValidationReport>(`/datasets/${encodeURIComponent(name)}/validate`);
