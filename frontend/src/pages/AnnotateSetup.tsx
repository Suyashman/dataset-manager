import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { listDatasetNames } from "@/api/datasets";
import { createEmptyDataset, createFromReference } from "@/api/annotation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Choice = "continue" | "fork" | null;

export function AnnotateSetup() {
  const navigate = useNavigate();
  const { data: datasetNames } = useQuery({ queryKey: ["dataset-names"], queryFn: listDatasetNames });
  const [name, setName] = useState("");
  const [choice, setChoice] = useState<Choice>(null);
  const [forkName, setForkName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = name.trim();
  const isExisting = !!trimmed && (datasetNames ?? []).includes(trimmed);

  const handleContinueNew = async () => {
    if (!trimmed) {
      toast.error("Give the dataset a name");
      return;
    }
    setSubmitting(true);
    try {
      await createEmptyDataset(trimmed);
      navigate(`/annotate/${encodeURIComponent(trimmed)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create dataset");
    } finally {
      setSubmitting(false);
    }
  };

  const handleContinueExisting = () => {
    navigate(`/annotate/${encodeURIComponent(trimmed)}`);
  };

  const handleFork = async () => {
    const newName = forkName.trim();
    if (!newName) {
      toast.error("Give the new dataset a name");
      return;
    }
    setSubmitting(true);
    try {
      await createFromReference(trimmed, newName);
      navigate(`/annotate/${encodeURIComponent(newName)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create dataset");
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
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setChoice(null);
                }}
                placeholder="pothole_detection"
              />
              {trimmed && (
                <Badge variant={isExisting ? "secondary" : "outline"} className="shrink-0">
                  {isExisting ? "existing dataset" : "will be created"}
                </Badge>
              )}
            </div>
          </div>

          {!isExisting && (
            <>
              <p className="text-xs text-muted-foreground">
                A new empty dataset will be created and you'll import images and start labeling next.
              </p>
              <Button className="w-full" onClick={handleContinueNew} disabled={submitting || !trimmed}>
                Continue to Workspace
              </Button>
            </>
          )}

          {isExisting && choice === null && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                '{trimmed}' already exists. Add more images directly into it, or start a separate dataset that
                begins from its class list without touching it.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={handleContinueExisting}>
                  Add to '{trimmed}'
                </Button>
                <Button className="flex-1" onClick={() => setChoice("fork")}>
                  Create new from '{trimmed}'
                </Button>
              </div>
            </div>
          )}

          {isExisting && choice === "fork" && (
            <div className="space-y-2">
              <Label>New dataset name</Label>
              <Input value={forkName} onChange={(e) => setForkName(e.target.value)} placeholder={`${trimmed}_v2`} />
              <p className="text-xs text-muted-foreground">
                Starts empty with the same classes as '{trimmed}' — '{trimmed}' itself is left untouched.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setChoice(null)} disabled={submitting}>
                  Back
                </Button>
                <Button className="flex-1" onClick={handleFork} disabled={submitting || !forkName.trim()}>
                  Create & Continue
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
