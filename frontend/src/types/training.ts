export const MODEL_VARIANTS = ["yolov8n", "yolov8s", "yolov8m", "yolov8l", "yolov8x"] as const;

export interface TrainRequest {
  dataset: string;
  model: string;
  epochs: number;
  batch: number;
  imgsz: number;
  device: string;
  lr0: number;
  patience: number;
  resume_run?: string | null;
  resume_weights?: "best" | "last";
}

export interface DeviceInfo {
  cuda_available: boolean;
  device_name: string | null;
  cpu_name: string;
}

export interface TrainingRun {
  run_name: string;
  dataset: string | null;
  has_best: boolean;
  has_last: boolean;
  completed_epochs: number;
  total_epochs: number | null;
  is_interrupted: boolean;
}
