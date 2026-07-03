import { api } from "@/api/client";
import type { JobStatus } from "@/types/job";

export const getJob = (jobId: string) => api.get<JobStatus>(`/jobs/${jobId}`);
