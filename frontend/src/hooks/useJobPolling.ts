import { useEffect, useRef, useState } from "react";
import { getJob } from "@/api/jobs";
import type { JobStatus } from "@/types/job";

export function useJobPolling(jobId: string | null) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }

    const poll = async () => {
      try {
        const status = await getJob(jobId);
        setJob(status);
        if (status.status === "completed" || status.status === "failed") {
          if (intervalRef.current) window.clearInterval(intervalRef.current);
        }
      } catch {
        if (intervalRef.current) window.clearInterval(intervalRef.current);
      }
    };

    poll();
    intervalRef.current = window.setInterval(poll, 1000);

    return () => {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, [jobId]);

  return job;
}
