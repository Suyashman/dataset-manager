export type JobStatusLiteral = "pending" | "running" | "completed" | "failed";

export interface JobProgress {
  current: number;
  total: number;
  percent: number;
}

export interface JobStatus {
  job_id: string;
  status: JobStatusLiteral;
  progress: JobProgress;
  message: string;
  result: Record<string, unknown> | null;
  error: string | null;
  metrics: Record<string, number>[];
  device_used: string | null;
  batch_progress: {
    epoch: number;
    total_epochs: number;
    batch: number;
    total_batches: number;
    images_done: number;
    images_total: number;
    speed_it_s: number;
    losses: Record<string, number>;
  } | null;
}
