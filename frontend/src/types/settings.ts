export interface SettingsModel {
  schema_version: number;
  default_dataset_folder: string;
  default_export_folder: string;
  default_prefixes: string[];
  theme: "dark" | "light";
  validation: { full_scan: boolean; hash_duplicate_check: boolean };
  pagination: { image_grid_page_size: number };
}
