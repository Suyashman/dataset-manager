import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PlugZap } from "lucide-react";
import { ApiError } from "@/api/client";
import { getSam3Env } from "@/api/sam3";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/** Resolves sidecar reachability once and shares it across every SAM3 screen.
 *
 * `retry: false` matters here for the same reason it does on single-resource lookups: a
 * missing sidecar is a settled answer, not a transient failure worth retrying. */
export function useSam3Env() {
  const query = useQuery({
    queryKey: ["sam3-env"],
    queryFn: getSam3Env,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const err = query.error instanceof ApiError ? query.error : null;
  return {
    env: query.data ?? null,
    isLoading: query.isLoading,
    unreachable: err?.code === "sam3_unreachable",
    detail: err?.message ?? "",
  };
}

export function Sam3Unreachable({ detail }: { detail?: string }) {
  return (
    <Card className="max-w-xl">
      <CardContent className="pt-6 space-y-3">
        <div className="flex items-center gap-2 font-medium">
          <PlugZap className="h-4 w-4 text-muted-foreground" />
          SAM3 is not running
        </div>
        <p className="text-sm text-muted-foreground">
          {detail ||
            "Start sam3_server.py on a machine with a CUDA GPU, then point this app at it."}
        </p>
        <p className="text-xs text-muted-foreground">
          SAM3 needs a CUDA GPU and the gated <code>facebook/sam3</code> weights, so it is not
          expected to run on CPU-only machines. Everything else in Dataset Manager works without
          it.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/settings">Set the sidecar URL</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
