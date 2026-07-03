import { api } from "@/api/client";
import type { SettingsModel } from "@/types/settings";

export const getSettings = () => api.get<SettingsModel>("/settings");
export const putSettings = (settings: SettingsModel) => api.put<SettingsModel>("/settings", settings);
