import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { listDatasetNames } from "@/api/datasets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function CleanDatasetSetup() {
  const navigate = useNavigate();
  const { data: datasetNames, isLoading } = useQuery({ queryKey: ["dataset-names"], queryFn: listDatasetNames });
  const [name, setName] = useState("");

  const handleStart = () => {
    if (name) navigate(`/annotate/${encodeURIComponent(name)}`);
  };

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-semibold mb-1">Clean Dataset</h1>
      <p className="text-muted-foreground mb-6">
        Step through every image in a dataset one at a time, check what its boxes actually highlight, fix a wrong
        class or a misshapen box, and delete images that shouldn't be in the dataset — nothing is created or
        restructured, you're editing what's already there.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dataset</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Choose a dataset to review</Label>
            <Select value={name} onValueChange={setName}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={isLoading ? "Loading…" : "Select a dataset"} />
              </SelectTrigger>
              <SelectContent>
                {(datasetNames ?? []).map((n) => (
                  <SelectItem key={n} value={n}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {datasetNames?.length === 0 && (
              <p className="text-xs text-muted-foreground">No datasets yet — create one first.</p>
            )}
          </div>
          <Button className="w-full" onClick={handleStart} disabled={!name}>
            Start Reviewing '{name || "..."}'
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
