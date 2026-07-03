export interface ImageInfo {
  filename: string;
  split: string;
  resolution: [number, number] | null;
  has_label: boolean;
  box_count: number;
}

export interface ImageListResponse {
  items: ImageInfo[];
  total: number;
  page: number;
  page_size: number;
}

export interface LabelBox {
  class_id: number;
  class_name: string;
  x_center: number;
  y_center: number;
  width: number;
  height: number;
}

export interface LabelResponse {
  boxes: LabelBox[];
  raw_text: string;
}
