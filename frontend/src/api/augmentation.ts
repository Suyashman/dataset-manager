import { api } from "@/api/client";
import type { AugmentRequest } from "@/types/augmentation";

export const startAugment = (req: AugmentRequest) => api.post<{ job_id: string }>("/augmentation/start", req);
