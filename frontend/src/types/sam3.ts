export interface Sam3Env {
  model_loaded: boolean;
  torch?: string;
  transformers?: string;
  gpu?: string;
  vram_free_gb?: number;
  vram_total_gb?: number;
  error?: string;
}

export interface Sam3BrowseDir {
  name: string;
  path: string;
  images: number;
}

export interface Sam3BrowseResult {
  path: string;
  parent: string;
  dirs: Sam3BrowseDir[];
  images_here: number;
}

export interface Sam3RunSummary {
  name: string;
  total: number;
  done: number;
  classes: string[];
  images: string;
  mtime: number;
}

export interface Sam3ClassStat {
  id: number;
  name: string;
  prompts: string[];
  accepted: number;
  review: number;
  dropped: number;
  rejected: number;
  total: number;
}

export interface Sam3Status {
  run: string;
  running: boolean;
  done: number;
  total: number;
  rate: number | null;
  eta: number | null;
  classes: Sam3ClassStat[];
  buckets: { accepted: number; review: number; dropped: number; rejected: number };
  instances: number;
  split_parts: number;
  empty_images: number;
  hist: number[];
  hist_lo: number;
  hist_hi: number;
  accept: number[];
  reject: number[];
  measured: { accept: Record<string, number>; source?: string } | null;
  decisions: number;
  folders: { name: string; images: number; instances: number; accepted: number }[];
  images_dir: string;
  log: string;
}

export interface Sam3ReviewItem {
  file: string;
  w: number;
  h: number;
  n_review: number;
  uncertainty: number;
}

export interface Sam3Instance {
  cls: number;
  prompt: string;
  score: number;
  poly: number[];
  box: [number, number, number, number];
  parts: number;
}

export type Sam3Decision = "accept" | "reject" | { cls: number };

export interface Sam3InstancesResult {
  file: string;
  w: number;
  h: number;
  instances: Sam3Instance[];
  decisions: Record<string, Sam3Decision>;
  classes: { id: number; name: string }[];
}

export interface Sam3RefinedInstance {
  score: number;
  poly: number[];
  parts: number;
  box: [number, number, number, number];
}

export interface Sam3RefineResult {
  instances: Sam3RefinedInstance[];
}

export interface Sam3ExportResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  manifest: string;
}

export interface Sam3ExportPreview {
  export_dir: string;
  // JSON object keys are always strings, matching DatasetDetail.classes in types/dataset.ts.
  classes: Record<string, string>;
  split_counts: Record<string, number>;
  total_images: number;
}
