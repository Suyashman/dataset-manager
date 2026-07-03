export interface DetectionBox {
  class_id: number;
  class_name: string;
  x_center: number;
  y_center: number;
  width: number;
  height: number;
  confidence: number;
}

export interface SpeedInfo {
  preprocess_ms: number;
  inference_ms: number;
  postprocess_ms: number;
  total_ms: number;
  fps: number;
}

export interface ImageInferenceResult {
  filename: string;
  boxes: DetectionBox[];
  annotated_url: string;
  speed: SpeedInfo;
}

export interface MultiImageInferenceResponse {
  results: ImageInferenceResult[];
}

export interface WebcamFrameResponse {
  boxes: DetectionBox[];
  speed: SpeedInfo;
}

export interface InferenceParams {
  run_name: string;
  weights: "best" | "last";
  device: string;
  conf: number;
  iou: number;
}
