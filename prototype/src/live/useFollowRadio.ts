import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { validSpotActivationSnapshot, type SpotActivationSnapshot } from "./spotActivation";

export type FollowRadioState = {
  enabled: boolean;
  epoch: number;
  error: string;
  operation: SpotActivationSnapshot;
  settlementPending: boolean;
};

function valid(value: unknown): value is FollowRadioState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return typeof state.enabled === "boolean" && Number.isSafeInteger(state.epoch) && Number(state.epoch) >= 0 &&
    typeof state.error === "string" && typeof state.settlementPending === "boolean" &&
    validSpotActivationSnapshot(state.operation);
}

/** Shared native Follow Radio permission. The native owner alone consumes
 * telemetry and mutates the canonical draft; renderers only express intent. */
export function useFollowRadio() {
  const [state, setState] = useState<FollowRadioState | null>(null), [error, setError] = useState("");
  const latest = useRef<FollowRadioState | null>(null), active = useRef(false), reading = useRef(false);
  const lifecycle = useRef(0), readEpoch = useRef(0), again = useRef(false), intent = useRef(0);
  const mutation = useRef<Promise<void>>(Promise.resolve());
  const adopt = useCallback((value: unknown) => {
    if (!valid(value)) throw new Error("Native Follow Radio status could not be verified.");
    if (active.current && (!latest.current || value.epoch >= latest.current.epoch)) {
      latest.current = value; setState(value); setError(value.error);
    }
    return value;
  }, []);
  const read = useCallback(async () => adopt(await invoke("operator_draft_follow_snapshot")), [adopt]);
  const refresh = useCallback(async () => {
    if (!active.current || reading.current || !isTauri()) return;
    reading.current = true;
    const mount = lifecycle.current;
    try {
      do {
        again.current = false; const captured = readEpoch.current;
        try { const value = await invoke("operator_draft_follow_snapshot"); if (active.current && mount === lifecycle.current && captured === readEpoch.current) adopt(value); }
        catch (cause) { if (active.current && mount === lifecycle.current && captured === readEpoch.current) setError(cause instanceof Error ? cause.message : "Native Follow Radio status unavailable."); }
      } while (active.current && mount === lifecycle.current && again.current);
    } finally { reading.current = false; }
  }, [adopt]);
  useEffect(() => {
    const mount = ++lifecycle.current; let mounted = true;
    active.current = true;
    if (!isTauri()) return () => { active.current = false; lifecycle.current++; };
    let stop: (() => void) | undefined;
    const wake = () => { readEpoch.current++; again.current = true; void refresh(); };
    void listen("xlog:operator-draft-follow", wake).then(value => { if (mounted) { stop = value; void refresh(); } else value(); })
      .catch(cause => { if (mounted) setError(cause instanceof Error ? cause.message : "Follow Radio updates unavailable."); });
    window.addEventListener("focus", wake); const timer = window.setInterval(() => void refresh(), 1500);
    return () => { mounted = false; if (mount === lifecycle.current) { active.current = false; lifecycle.current++; } stop?.(); clearInterval(timer); window.removeEventListener("focus", wake); };
  }, [refresh]);
  const set = useCallback((enabled: boolean): Promise<FollowRadioState> => {
    if (!isTauri()) return Promise.reject(new Error("Follow Radio requires the native station owner."));
    const requested = ++intent.current;
    const action = mutation.current.catch(() => {}).then(async () => {
      if (!active.current) throw new Error("Follow Radio control is unavailable.");
      let current = latest.current ?? await read();
      // A newer same-renderer intent superseded this one before dispatch.
      if (requested !== intent.current) return current;
      if (current.enabled === enabled) return current;
      try {
        current = adopt(await invoke("operator_draft_follow_set", { enabled, expectedEpoch: current.epoch }));
        return current;
      } catch (cause) {
        // Refresh only; never replay across an epoch owned by another window.
        await read().catch(() => {});
        throw cause;
      }
    });
    mutation.current = action.then(() => {}, () => {});
    return action;
  }, [adopt, read]);
  return { state, error, refresh, set };
}
