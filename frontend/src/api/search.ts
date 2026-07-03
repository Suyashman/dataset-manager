import { api } from "@/api/client";

export interface SearchResults {
  images: { dataset: string; split: string; filename: string }[];
  classes: { dataset: string; class_id: number; class_name: string }[];
  filenames: { dataset: string; split: string; filename: string }[];
  prefixes: { dataset: string; prefix: string; last_number: number }[];
}

export const search = (q: string, scope = "all", dataset?: string) => {
  const params = new URLSearchParams({ q, scope });
  if (dataset) params.set("dataset", dataset);
  return api.get<SearchResults>(`/search?${params}`);
};
