import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { WorkspacePanelID } from "./workspaceLayoutSession";

export const nativeWorkspaceWindowIDs = ["monitor", "world-map", "band-maps", "dx-cluster", "logbook", "awards"] as const satisfies readonly WorkspacePanelID[];
export type NativeWorkspaceWindowID = typeof nativeWorkspaceWindowIDs[number];
export type WorkspaceWindowsStatus = {
  supported: WorkspacePanelID[];
  generation: string | null;
  revision: number | null;
  presetID: string | null;
  state: "idle" | "applying" | "applied" | "error";
  shown: NativeWorkspaceWindowID[];
  hidden: NativeWorkspaceWindowID[];
  error: string;
  stopped: boolean;
  attempt: number;
};

/** These are native observations, never instructions derived from event payloads. */
export function readWorkspaceWindowsStatus(value: unknown): WorkspaceWindowsStatus {
  const invalid = () => { throw new Error("The native workspace window status could not be verified."); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const item = value as Record<string, unknown>;
  const ids = (list: unknown): list is NativeWorkspaceWindowID[] => Array.isArray(list)
    && list.length <= nativeWorkspaceWindowIDs.length && new Set(list).size === list.length
    && list.every(id => nativeWorkspaceWindowIDs.includes(id as NativeWorkspaceWindowID));
  if (!ids(item.supported) || !ids(item.shown) || !ids(item.hidden)) return invalid();
  const supported = item.supported, shown = item.shown, hidden = item.hidden;
  if ([...shown, ...hidden].some(id => !supported.includes(id))
    || (item.generation !== null && !(typeof item.generation === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.generation)))
    || (item.revision !== null && !(Number.isSafeInteger(item.revision) && (item.revision as number) >= 0))
    || (item.presetID !== null && !(typeof item.presetID === "string" && /^[a-z0-9-]{1,64}$/.test(item.presetID)))
    || !["idle", "applying", "applied", "error"].includes(item.state as string)
    || (item.state === "applied" && (item.generation === null || item.revision === null || item.presetID === null))
    || typeof item.error !== "string" || item.error.length > 4096 || typeof item.stopped !== "boolean"
    || !Number.isSafeInteger(item.attempt) || (item.attempt as number) < 0) return invalid();
  return { supported: [...item.supported], generation: item.generation as string | null,
    revision: item.revision as number | null, presetID: item.presetID as string | null,
    state: item.state as WorkspaceWindowsStatus["state"], shown: [...item.shown], hidden: [...item.hidden],
    error: item.error, stopped: item.stopped, attempt: item.attempt as number };
}

const message = (error: unknown) => (error instanceof Error ? error.message : typeof error === "string" ? error : "Native workspace windows are unavailable.").slice(0, 4096);

export function useWorkspaceWindows(): { status: WorkspaceWindowsStatus | null; error: string; retry: () => Promise<void>; retrying: boolean } {
  const [status, setStatus] = useState<WorkspaceWindowsStatus | null>(null);
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const retryAction = useRef<(() => Promise<void>) | null>(null);
  const retry = useCallback(async () => { await retryAction.current?.(); }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let active = true, ready = false, reading = false, dirty = false, reconciling = false, enqueueing = false;
    let requestedAttempt: number | null = null, retryReadError = "";
    let subscriptionError = "", unlisten: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    // A single read and one dirty bit bound the queue and preserve response order.
    const refresh = async () => {
      if (!active || !ready) return;
      if (reading) { dirty = true; return; }
      reading = true;
      try {
        const next = readWorkspaceWindowsStatus(await invoke("workspace_windows_status"));
        if (active) {
          setStatus(next);
          // Shutdown may discard an accepted queue entry before publishing its
          // attempt. It fences all work and must not leave retry permanently busy.
          if (requestedAttempt !== null && (next.stopped || next.attempt >= requestedAttempt && ["applied", "error"].includes(next.state))) {
            requestedAttempt = null; retryReadError = ""; reconciling = false; setRetrying(false);
          }
          setError(next.stopped ? "The native workspace window owner has stopped." : retryReadError || subscriptionError);
        }
      } catch (failure) {
        if (active) {
          setStatus(null);
          if (requestedAttempt !== null) {
            // Keep the ticket and uncertainty until a matching terminal read,
            // but enable recovery rather than leaving the button busy forever.
            retryReadError = `Native window application could not be confirmed. Refocus or apply saved windows again. ${message(failure)}`.slice(0, 4096);
            reconciling = false; setRetrying(false);
          }
          setError(retryReadError || message(failure));
        }
      } finally {
        reading = false;
        if (active && dirty) { dirty = false; schedule(); }
      }
    };
    const schedule = () => {
      if (!active) return;
      if (reading) { dirty = true; return; }
      if (timer !== undefined) return;
      timer = setTimeout(() => { timer = undefined; void refresh(); }, 50);
    };
    retryAction.current = async () => {
      if (!active || reconciling || enqueueing) return;
      enqueueing = true; reconciling = true; setRetrying(true);
      // A recovery enqueue supersedes the uncertain previous attempt. Its late
      // terminal read must not release this request before its own ticket arrives.
      requestedAttempt = null;
      try {
        // Acknowledgement only queues work. Only subsequent status proves application.
        const acknowledgement = await invoke<unknown>("workspace_windows_reconcile");
        if (!active) return;
        if (!acknowledgement || typeof acknowledgement !== "object" || Array.isArray(acknowledgement)
          || !Number.isSafeInteger((acknowledgement as { attempt?: unknown }).attempt)
          || ((acknowledgement as { attempt: number }).attempt) < 1)
          throw new Error("The native workspace window retry acknowledgement could not be verified.");
        requestedAttempt = (acknowledgement as { attempt: number }).attempt;
        retryReadError = ""; setError(subscriptionError); await refresh();
      } catch (failure) {
        if (active) {
          // A rejected/unverifiable enqueue has no completion ticket. An old
          // applied snapshot cannot prove what happened to that request.
          retryReadError = message(failure); reconciling = false;
          setStatus(null); setRetrying(false); setError(retryReadError);
        }
      } finally { enqueueing = false; }
    };
    window.addEventListener("focus", schedule);
    void listen("xlog:workspace-windows", schedule).then(dispose => {
      if (!active) { dispose(); return; }
      unlisten = dispose; ready = true; void refresh();
    }).catch(failure => {
      if (!active) return;
      subscriptionError = `Live native window updates are unavailable. Refocus to reload. ${message(failure)}`.slice(0, 4096);
      ready = true; void refresh();
    });
    return () => { active = false; retryAction.current = null; clearTimeout(timer); unlisten?.(); window.removeEventListener("focus", schedule); };
  }, []);
  return { status, error, retry, retrying };
}
