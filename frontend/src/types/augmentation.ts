export type AugTechniqueType = "flip" | "rotate" | "hsv" | "blur" | "noise";

export interface AugTechniqueConfig {
  type: AugTechniqueType;
  copies: number;
  angle_range: [number, number];
  hsv_h: number;
  hsv_s: number;
  hsv_v: number;
  blur_kernel_range: [number, number];
  noise_sigma_range: [number, number];
}

export interface AugmentRequest {
  source: string;
  destination: string;
  techniques: AugTechniqueConfig[];
}

export const AUG_TECHNIQUE_LABELS: Record<AugTechniqueType, string> = {
  flip: "Horizontal Flip",
  rotate: "Rotate",
  hsv: "HSV Jitter",
  blur: "Blur",
  noise: "Noise",
};
