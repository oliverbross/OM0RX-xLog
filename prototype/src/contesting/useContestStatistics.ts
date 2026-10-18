import { useEffect, useState } from "react";
import type { ContestClient } from "./client";
import type { ContestSessionSummary, ContestStatistics } from "./types";

const identity = (session: ContestSessionSummary) => `${session.sessionID}/${session.workspaceGeneration}/${session.revision}`;

/** Read-only clock projection. It owns no mutation lease and never replaces a
 * last valid sample with an error from a refresh of the same coordinate. */
export function useContestStatistics(client: Pick<ContestClient, "statistics">, session: ContestSessionSummary | null,
  enabled: boolean, refreshMilliseconds = 60_000) {
  const key = session ? identity(session) : "";
  const [sample, setSample] = useState<{ key: string; value: ContestStatistics } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  useEffect(() => {
    if (!session || !enabled) return;
    let cancelled = false, ticket = 0;
    const refresh = async () => { const current = ++ticket;
      try { const value = await client.statistics(session); if (!cancelled && current === ticket) {
        setSample({ key, value }); setFailure(null);
      } } catch (cause) { if (!cancelled && current === ticket) setFailure({ key, message: cause instanceof Error ? cause.message : String(cause) }); }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), refreshMilliseconds);
    return () => { cancelled = true; ticket += 1; window.clearInterval(timer); };
  }, [client, key, enabled, refreshMilliseconds]);
  return { statistics: sample?.key === key ? sample.value : null, error: failure?.key === key ? failure.message : "" };
}
