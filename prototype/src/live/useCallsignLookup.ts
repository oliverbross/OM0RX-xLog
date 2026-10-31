import { useEffect, useRef, useState } from "react";
import { boundedCallsignLookup, callsignLookupDeadlineMs } from "./callsignLookupRecovery";
import { normalizedCall } from "./draftEnrichment";
type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<any>;

export function useCallsignLookup({ draft, generation, workspaceExists, request, canEnrich, enrich }: {
  draft: Data | null; generation?: string; workspaceExists: boolean; request: Request;
  canEnrich: () => boolean; enrich: (baseline: Data, profile: Data) => void;
}) {
  const call = normalizedCall(draft?.call);
  const scope = JSON.stringify([generation?.toLowerCase() ?? "", draft?.id ?? "", call]);
  const handlers = useRef({ canEnrich, enrich }); handlers.current = { canEnrich, enrich };
  const latest = useRef({ scope, workspaceExists }); latest.current = { scope, workspaceExists };
  const [retry, setRetry] = useState({ scope: "", revision: 0 });
  const [state, setState] = useState<{ scope: string; profile: Data | null; previous: Data[]; pending: boolean }>({ scope: "", profile: null, previous: [], pending: false });
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController(), baseline = draft;
    const currentScope = () => !disposed && latest.current.scope === scope && latest.current.workspaceExists;
    const readOnlyRetry = retry.scope === scope;
    setState(current => ({ scope, profile: call && workspaceExists && current.scope === scope ? current.profile : null, previous: call && workspaceExists && current.scope === scope ? current.previous : [], pending: !!call && workspaceExists }));
    if (!call || !workspaceExists) return () => { disposed = true; controller.abort(); };
    const timer = setTimeout(() => {
      void boundedCallsignLookup(request, call, callsignLookupDeadlineMs, { signal: controller.signal, scope }).then(profile => {
        if (!currentScope()) return;
        setState(current => ({ ...current, scope, profile, pending: false }));
        if (!readOnlyRetry && baseline && handlers.current.canEnrich()) handlers.current.enrich(baseline, profile);
      }).catch(cause => {
        if (!currentScope()) return;
        setState(current => ({ ...current, scope, pending: false,
          profile: { call, source: cause instanceof Error ? cause.message : "Lookup unavailable", lookup_error: true } }));
      });
      void request("logbook_previous", { call, limit: 25 }).then(history => {
        if (currentScope()) setState(current => ({ ...current, previous: Array.isArray(history?.qsos) ? history.qsos : [] }));
      }).catch(() => { if (currentScope()) setState(current => ({ ...current, previous: [] })); });
    }, 400);
    return () => { disposed = true; clearTimeout(timer); controller.abort(); };
  }, [scope, request, workspaceExists, retry]);
  return {
    lookup: state.scope === scope ? state.profile : null,
    previous: state.scope === scope ? state.previous : [],
    lookupPending: state.scope === scope && state.pending,
    retryRevision: retry.revision,
    retryLookup: () => setRetry(current => ({ scope, revision: current.revision + 1 })),
  };
}
