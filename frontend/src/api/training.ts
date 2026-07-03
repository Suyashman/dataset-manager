import { api } from "@/api/client";
import type { DeviceInfo, TrainingRun, TrainRequest } from "@/types/training";

export const getDeviceInfo = () => api.get<DeviceInfo>("/training/device");
export const listRuns = () => api.get<TrainingRun[]>("/training/runs");
export const startTraining = (req: TrainRequest) => api.post<{ job_id: string }>("/training/start", req);
export const stopTraining = (jobId: string) => api.post<{ stopping: boolean }>(`/training/${jobId}/stop`, {});
