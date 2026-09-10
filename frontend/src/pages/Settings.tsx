import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { getSettings, putSettings } from "@/api/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import type { SettingsModel } from "@/types/settings";

export function Settings() {
  const { data } = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const [form, setForm] = useState<SettingsModel | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  if (!form) return null;

  const save = async () => {
    setSaving(true);
    try {
      await putSettings(form);
      toast.success("Settings saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Default dataset folder</Label>
            <Input
              value={form.default_dataset_folder}
              onChange={(e) => setForm({ ...form, default_dataset_folder: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Default export folder</Label>
            <Input
              value={form.default_export_folder}
              onChange={(e) => setForm({ ...form, default_export_folder: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Default prefixes (comma separated)</Label>
            <Input
              value={form.default_prefixes.join(", ")}
              onChange={(e) =>
                setForm({ ...form, default_prefixes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>SAM3 sidecar URL</Label>
            <Input
              value={form.sam3_sidecar_url}
              onChange={(e) => setForm({ ...form, sam3_sidecar_url: e.target.value })}
              placeholder="http://127.0.0.1:8800"
            />
            <p className="text-xs text-muted-foreground">
              Where the SAM3 auto-labeler is running. It needs a CUDA GPU, so leave this alone on
              CPU-only machines — the rest of the app works without it.
            </p>
          </div>
          <div className="flex items-center justify-between">
            <Label>Dark mode</Label>
            <Switch
              checked={form.theme === "dark"}
              onCheckedChange={(checked) => setForm({ ...form, theme: checked ? "dark" : "light" })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Full validation scan</Label>
            <Switch
              checked={form.validation.full_scan}
              onCheckedChange={(checked) =>
                setForm({ ...form, validation: { ...form.validation, full_scan: checked } })
              }
            />
          </div>
          <div className="flex items-center justify-between">
            <Label>Hash-based duplicate check</Label>
            <Switch
              checked={form.validation.hash_duplicate_check}
              onCheckedChange={(checked) =>
                setForm({ ...form, validation: { ...form.validation, hash_duplicate_check: checked } })
              }
            />
          </div>
          <Button className="w-full" onClick={save} disabled={saving}>
            Save Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
