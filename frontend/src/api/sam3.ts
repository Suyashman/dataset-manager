import { api } from "@/api/client";
import type {
  Sam3BrowseResult,
  Sam3Decision,
  Sam3Env,
  Sam3ExportPreview,
  Sam3ExportResult,
  Sam3InstancesResult,
  Sam3RefineResult,
  Sam3ReviewItem,
  Sam3RunSummary,
  Sam3Status,
} from "@/types/sam3";

const q = encodeURIComponent;

export const getSam3Env = () => api.get<Sam3Env>("/sam3/env");
// No path on first load: the sidecar knows which roots exist on the machine it runs on.
export const browseSam3 = (path?: string) =>
  api.get<Sam3BrowseResult>(path ? `/sam3/browse?path=${q(path)}` : "/sam3/browse");
export const listSam3Runs = () => api.get<Sam3RunSummary[]>("/sam3/runs");

export const startSam3Run = (req: {
  images: string;
  classes: { name: string; prompts: string[] }[];
  name: string;
  sample?: number;
}) => api.post<{ started: string; cmd: string }>("/sam3/run", req);

export const cancelSam3Run = (run: string) => api.post<{ cancelled: boolean }>("/sam3/cancel", { run });

export const getSam3Status = (run: string, accept: string, reject: string) =>
  api.get<Sam3Status>(`/sam3/status?run=${q(run)}&accept=${q(accept)}&reject=${q(reject)}`);

export const getSam3Review = (run: string, accept: string, reject: string, limit = 400) =>
  api.get<{ total: number; items: Sam3ReviewItem[] }>(
    `/sam3/review?run=${q(run)}&accept=${q(accept)}&reject=${q(reject)}&limit=${limit}`
  );

export const getSam3Instances = (run: string, file: string) =>
  api.get<Sam3InstancesResult>(`/sam3/instances?run=${q(run)}&file=${q(file)}`);

// Consumed as an image element's src attribute rather than fetched: the bytes stream straight
// through the proxy with their content type intact.
export const sam3ImageUrl = (run: string, file: string) =>
  `/api/sam3/image?run=${q(run)}&file=${q(file)}`;

export const postSam3Decision = (req: {
  run: string;
  file: string;
  idx: number;
  decision: Sam3Decision | null;
}) => api.post<{ ok: boolean; decisions: number }>("/sam3/decision", req);

export const refineSam3 = (req: {
  run: string;
  file: string;
  text?: string;
  boxes: number[][];
  labels: number[];
  threshold?: number;
}) => api.post<Sam3RefineResult>("/sam3/refine", req);

export const adoptSam3 = (req: { run: string; file: string; cls: number; instances: unknown[] }) =>
  api.post<{ ok: boolean; n: number }>("/sam3/adopt", req);

export const exportSam3 = (req: {
  run: string;
  out: string;
  accept: string;
  reject: string;
  val: number;
  group_by_dir: boolean;
  copy_images: boolean;
}) => api.post<Sam3ExportResult>("/sam3/export", req);

export const previewSam3Export = (exportDir: string) =>
  api.get<Sam3ExportPreview>(`/sam3/export-preview?export_dir=${q(exportDir)}`);

export const importSam3Export = (req: {
  export_dir: string;
  destination: string;
  prefix: string;
  splits_to_include: string[];
  class_filter?: Record<string, string> | null;
}) => api.post<{ job_id: string }>("/sam3/import", req);
