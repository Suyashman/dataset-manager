import { api } from "@/api/client";
import type {
  ImageInferenceResult,
  InferenceParams,
  MultiImageInferenceResponse,
  WebcamFrameResponse,
} from "@/types/inference";

function paramsToFormData(params: InferenceParams, extra?: FormData): FormData {
  const fd = extra ?? new FormData();
  fd.append("run_name", params.run_name);
  fd.append("weights", params.weights);
  fd.append("device", params.device);
  fd.append("conf", String(params.conf));
  fd.append("iou", String(params.iou));
  return fd;
}

export const inferImage = (file: File, params: InferenceParams) => {
  const fd = new FormData();
  fd.append("image", file);
  paramsToFormData(params, fd);
  return api.postForm<ImageInferenceResult>("/inference/image", fd);
};

export const inferImages = (files: File[], params: InferenceParams) => {
  const fd = new FormData();
  files.forEach((f) => fd.append("images", f));
  paramsToFormData(params, fd);
  return api.postForm<MultiImageInferenceResponse>("/inference/images", fd);
};

export const inferWebcamFrame = (frame: Blob, params: InferenceParams) => {
  const fd = new FormData();
  fd.append("frame", frame, "frame.jpg");
  paramsToFormData(params, fd);
  return api.postForm<WebcamFrameResponse>("/inference/webcam-frame", fd);
};

export const inferVideo = (file: File, params: InferenceParams, frameStride: number) => {
  const fd = new FormData();
  fd.append("video", file);
  paramsToFormData(params, fd);
  fd.append("frame_stride", String(frameStride));
  return api.postForm<{ job_id: string }>("/inference/video", fd);
};
