export interface DatasetSummary {
  name: string;
  splits: Record<string, number>;
  total_images: number;
  num_classes: number;
  last_modified: string | null;
  size_bytes: number;
}

export interface DatasetDetail {
  name: string;
  splits: Record<string, number>;
  total_images: number;
  classes: Record<string, string>;
  last_modified: string | null;
  size_bytes: number;
  history: HistoryEvent[];
}

export interface HistoryEvent {
  event: string;
  timestamp: string;
  source_dataset?: string;
  prefix?: string;
  images_added?: number;
  images_skipped?: number;
  splits?: Record<string, number>;
  class_remap?: { old: Record<string, string>; new: Record<string, string> };
  dropped_classes?: Record<string, string> | null;
  errors?: { file: string; reason: string }[] | null;
  techniques?: Record<string, number>;
  dropped_boxes?: number;
}

export interface CreateDatasetRequest {
  source: string;
  new_name: string;
  prefix: string;
  splits_to_include: string[];
  class_filter?: Record<string, string>;
}

export interface MergeDatasetRequest {
  source: string;
  destination: string;
  prefix: string;
  splits_to_include: string[];
  class_filter?: Record<string, string>;
}

export interface MergeSourceEntry {
  source: string;
  prefix: string;
  class_filter?: Record<string, string>;
}

export interface MergeMultiRequest {
  destination: string;
  sources: MergeSourceEntry[];
  splits_to_include: string[];
}
