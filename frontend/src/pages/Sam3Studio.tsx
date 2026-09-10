import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sam3Unreachable, useSam3Env } from "@/components/Sam3Unreachable";
import { Sam3RunPanel } from "@/components/sam3/Sam3RunPanel";
import { Sam3RunsPanel } from "@/components/sam3/Sam3RunsPanel";
import { Sam3ReviewPanel } from "@/components/sam3/Sam3ReviewPanel";

export function Sam3Studio() {
  const { env, isLoading, unreachable, detail } = useSam3Env();
  const [tab, setTab] = useState("run");
  // Lifted here because Review sets the gate and Export reads the same values.
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [accept, setAccept] = useState("0.6");
  const [reject, setReject] = useState("0.4");

  const header = (
    <>
      <h1 className="text-2xl font-semibold mb-1">SAM3 Auto-Label</h1>
      <p className="text-muted-foreground mb-2">
        AI-assisted pre-labeling: name the concepts you want, review what SAM3 found, then import
        the accepted labels into a dataset. These are model predictions — nothing here should reach
        a training run unreviewed.
      </p>
    </>
  );

  if (isLoading) return <div className="max-w-3xl">{header}</div>;

  if (unreachable) {
    return (
      <div className="max-w-3xl">
        {header}
        <div className="mt-4">
          <Sam3Unreachable detail={detail} />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      {header}
      {env?.gpu && (
        <p className="text-xs text-muted-foreground mb-6">
          {env.gpu}
          {env.vram_free_gb != null &&
            ` · ${env.vram_free_gb} GB VRAM free of ${env.vram_total_gb} GB`}
          {env.torch && ` · torch ${env.torch}`}
        </p>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="run">Run</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

        <TabsContent value="run" className="space-y-4">
          <Sam3RunPanel
            onStarted={(run) => {
              setSelectedRun(run);
              setTab("runs");
            }}
          />
        </TabsContent>
        <TabsContent value="runs" className="space-y-4">
          <Sam3RunsPanel
            selectedRun={selectedRun}
            onSelectRun={setSelectedRun}
            accept={accept}
            reject={reject}
          />
        </TabsContent>
        <TabsContent value="review" className="space-y-4">
          {selectedRun ? (
            <Sam3ReviewPanel
              run={selectedRun}
              accept={accept}
              reject={reject}
              onGateChange={(a, r) => {
                setAccept(a);
                setReject(r);
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Pick a run on the Runs tab first.</p>
          )}
        </TabsContent>
        <TabsContent value="export" className="space-y-4">
          <p className="text-sm text-muted-foreground">Export panel — Task 11.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
