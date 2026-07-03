import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { listDatasetNames } from "@/api/datasets";
import { createEmptyDataset } from "@/api/annotation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function AnnotateSetup() {
  const navigate = useNavigate();
  const { data: datasetNames } = useQuery({ queryKey: ["dataset-names"], queryFn: listDatasetNames });
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isExisting = !!name.trim() && (datasetNames ?? []).includes(name.trim());

  const handleContinue = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give the dataset a name");
      return;
    }
    setSubmitting(true);
    try {
      if (!isExisting) {
        await createEmptyDataset(trimmed);
      }
      navigate(`/annotate/${encodeURIComponent(trimmed)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to open dataset");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold mb-1">Annotate</h1>
      <p className="text-muted-foreground mb-6">
        Draw bounding boxes on your own images to build a YOLO dataset from scratch — pick an existing dataset to
        keep labeling, or start a new one.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dataset</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Dataset name</Label>
            <div className="flex items-center gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="pothole_detection" />
              {name.trim() && (
                <Badge variant={isExisting ? "secondary" : "outline"} className="shrink-0">
                  {isExisting ? "existing dataset" : "will be created"}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              You'll import images and open the annotation workspace next. Adding more images later, or continuing
              on unfinished images, both work on an existing dataset.
            </p>
          </div>

          <Button className="w-full" onClick={handleContinue} disabled={submitting}>
            Continue to Workspace
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
