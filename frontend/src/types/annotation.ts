export interface ImportFolderRequest {
  folder_path: string;
  split: string;
  prefix: string;
}

export interface ImportFolderResponse {
  images_added: number;
  images_skipped: number;
  errors: { file: string; reason: string }[];
}

export interface Box {
  class_id: number;
  x_center: number;
  y_center: number;
  width: number;
  height: number;
}

export interface FlaggedItem {
  split: string;
  filename: string;
  reasons: string[];
}
