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
    || typeof item.error !== "string" || item.error.length > 4096 || typeof item.stopped !== "boolean") return invalid();
  return { supported: [...item.supported], generation: item.generation as string | null,
    revision: item.revision as number | null, presetID: item.presetID as string | null,
    state: item.state as WorkspaceWindowsStatus["state"], shown: [...item.shown], hidden: [...item.hidden],
    error: item.error, stopped: item.stopped };
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
    let active = true, ready = false, reading = false, dirty = false, reconciling = false;
    let subscriptionError = "", unlisten: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    // A single read and one dirty bit bound the queue and preserve response order.
    const refresh = async () => {
      if (!active || !ready) return;
      if (reading) { dirty = true; return; }
      reading = true;
      try {
        const next = readWorkspaceWindowsStatus(await invoke("workspace_windows_status"));
        if (active) { setStatus(next); setError(subscriptionError); }
      } catch (failure) {
        if (active) { setStatus(null); setError(message(failure)); }
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
      if (!active || reconciling) return;
      reconciling = true; setRetrying(true);
      try {
        // Acknowledgement only queues work. Only subsequent status proves application.
        await invoke("workspace_windows_reconcile");
        if (active) { setError(subscriptionError); await refresh(); }
      } catch (failure) { if (active) setError(message(failure)); }
      finally { reconciling = false; if (active) setRetrying(false); }
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
