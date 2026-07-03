export interface SplitStats {
  images: number;
  labels: number;
}

export interface DatasetStats {
  dataset: string;
  total_images: number;
  splits: Record<string, SplitStats>;
  num_labels: number;
  num_classes: number;
  avg_images_per_class: number;
  missing_labels: number;
  missing_images: number;
  duplicate_images: number;
  duplicate_labels: number;
  corrupted_files: number;
  empty_label_files: number;
}

export interface ValidationIssue {
  check: string;
  severity: "error" | "warning" | "info";
  split?: string | null;
  file?: string | null;
  line_number?: number | null;
  message: string;
  details: Record<string, unknown>;
}

export interface ValidationReport {
  dataset: string;
  issues: ValidationIssue[];
  summary: Record<string, number>;
}
