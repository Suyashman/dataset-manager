import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { listDatasetNames } from "@/api/datasets";
import { startAugment } from "@/api/augmentation";
import { AUG_TECHNIQUE_LABELS, type AugTechniqueConfig, type AugTechniqueType } from "@/types/augmentation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProgressDialog } from "@/components/ProgressDialog";

const ALL_TECHNIQUES: AugTechniqueType[] = ["flip", "rotate", "hsv", "blur", "noise"];

const defaultConfig = (type: AugTechniqueType): AugTechniqueConfig => ({
  type,
  copies: 1,
  angle_range: [-15, 15],
  hsv_h: 0.015,
  hsv_s: 0.7,
  hsv_v: 0.4,
  blur_kernel_range: [3, 7],
  noise_sigma_range: [5, 25],
});

export function AugmentDataset() {
  const navigate = useNavigate();
  const { data: datasetNames } = useQuery({ queryKey: ["dataset-names"], queryFn: listDatasetNames });

  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [destinationTouched, setDestinationTouched] = useState(false);
  const [techniques, setTechniques] = useState<Partial<Record<AugTechniqueType, AugTechniqueConfig>>>({});
  const [jobId, setJobId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (source && !destinationTouched) setDestination(`${source}_aug`);
  }, [source, destinationTouched]);

  const toggleTechnique = (type: AugTechniqueType) => {
    setTechniques((prev) => {
      const next = { ...prev };
      if (next[type]) delete next[type];
      else next[type] = defaultConfig(type);
      return next;
    });
  };

  const updateTechnique = (type: AugTechniqueType, patch: Partial<AugTechniqueConfig>) => {
    setTechniques((prev) => (prev[type] ? { ...prev, [type]: { ...prev[type]!, ...patch } } : prev));
  };

  const selectedCount = Object.keys(techniques).length;

  const handleSubmit = async () => {
    if (!source) {
      toast.error("Choose a source dataset");
      return;
    }
    if (!destination.trim()) {
      toast.error("Give the augmented dataset a name");
      return;
    }
    if (selectedCount === 0) {
      toast.error("Pick at least one augmentation technique");
      return;
    }
    setSubmitting(true);
    try {
      const { job_id } = await startAugment({
        source,
        destination,
        techniques: Object.values(techniques) as AugTechniqueConfig[],
      });
      setJobId(job_id);
      setDialogOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start augmentation");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-1">Augment Dataset</h1>
      <p className="text-muted-foreground mb-6">
        Clone a dataset and add transformed copies of its training images — original images, and
        the valid/test splits, are never touched.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Source &amp; Destination</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Source dataset</Label>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose dataset" />
              </SelectTrigger>
              <SelectContent>
                {(datasetNames ?? []).map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>New dataset name</Label>
            <Input
              value={destination}
              onChange={(e) => {
                setDestination(e.target.value);
                setDestinationTouched(true);
              }}
              placeholder="PPE_Master_aug"
            />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3 mt-4">
        {ALL_TECHNIQUES.map((type) => {
          const cfg = techniques[type];
          const checked = !!cfg;
          return (
            <Card key={type}>
              <CardHeader className="flex flex-row items-center gap-2 space-y-0">
                <Checkbox checked={checked} onCheckedChange={() => toggleTechnique(type)} />
                <CardTitle className="text-base">{AUG_TECHNIQUE_LABELS[type]}</CardTitle>
              </CardHeader>
              {checked && (
                <CardContent className="space-y-3">
                  <div className="space-y-2 max-w-40">
                    <Label className="text-xs">Copies per image</Label>
                    <Input
                      type="number"
                      min={1}
                      value={cfg.copies}
                      onChange={(e) => updateTechnique(type, { copies: Math.max(1, Number(e.target.value)) })}
                    />
                  </div>

                  {type === "rotate" && (
                    <div className="space-y-2">
                      <Label className="text-xs">Angle range (degrees)</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={cfg.angle_range[0]}
                          onChange={(e) =>
                            updateTechnique(type, { angle_range: [Number(e.target.value), cfg.angle_range[1]] })
                          }
                        />
                        <span className="text-muted-foreground text-sm">to</span>
                        <Input
                          type="number"
                          value={cfg.angle_range[1]}
                          onChange={(e) =>
                            updateTechnique(type, { angle_range: [cfg.angle_range[0], Number(e.target.value)] })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {type === "hsv" && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-2">
                        <Label className="text-xs">Hue gain</Label>
                        <Input
                          type="number"
                          step={0.005}
                          value={cfg.hsv_h}
                          onChange={(e) => updateTechnique(type, { hsv_h: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Saturation gain</Label>
                        <Input
                          type="number"
                          step={0.05}
                          value={cfg.hsv_s}
                          onChange={(e) => updateTechnique(type, { hsv_s: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Value gain</Label>
                        <Input
                          type="number"
                          step={0.05}
                          value={cfg.hsv_v}
                          onChange={(e) => updateTechnique(type, { hsv_v: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                  )}

                  {type === "blur" && (
                    <div className="space-y-2">
                      <Label className="text-xs">Kernel size range (odd numbers)</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          step={2}
                          value={cfg.blur_kernel_range[0]}
                          onChange={(e) =>
                            updateTechnique(type, {
                              blur_kernel_range: [Number(e.target.value), cfg.blur_kernel_range[1]],
                            })
                          }
                        />
                        <span className="text-muted-foreground text-sm">to</span>
                        <Input
                          type="number"
                          step={2}
                          value={cfg.blur_kernel_range[1]}
                          onChange={(e) =>
                            updateTechnique(type, {
                              blur_kernel_range: [cfg.blur_kernel_range[0], Number(e.target.value)],
                            })
                          }
                        />
                      </div>
                    </div>
                  )}

                  {type === "noise" && (
                    <div className="space-y-2">
                      <Label className="text-xs">Noise std-dev range</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          value={cfg.noise_sigma_range[0]}
                          onChange={(e) =>
                            updateTechnique(type, {
                              noise_sigma_range: [Number(e.target.value), cfg.noise_sigma_range[1]],
                            })
                          }
                        />
                        <span className="text-muted-foreground text-sm">to</span>
                        <Input
                          type="number"
                          value={cfg.noise_sigma_range[1]}
                          onChange={(e) =>
                            updateTechnique(type, {
                              noise_sigma_range: [cfg.noise_sigma_range[0], Number(e.target.value)],
                            })
                          }
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <Button className="w-full mt-4" onClick={handleSubmit} disabled={submitting}>
        {selectedCount > 0 ? `Augment with ${selectedCount} Technique${selectedCount > 1 ? "s" : ""}` : "Augment Dataset"}
      </Button>

      <ProgressDialog
        jobId={jobId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={`Augmenting into ${destination || "dataset"}`}
        onComplete={() => navigate(`/datasets/${encodeURIComponent(destination)}`)}
      />
    </div>
  );
}
