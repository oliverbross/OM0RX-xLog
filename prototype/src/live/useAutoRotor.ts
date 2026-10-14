import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { RotorSnapshot } from "./rotorControl";
export type AutomaticRotorState = { armed: boolean; epoch: number; owner: string | null; generation: number | null;
  target: unknown; activation_pending: boolean; canonical_pending: boolean; error: string };
function valid(value: any): value is AutomaticRotorState {
  return value && typeof value.armed === "boolean" && Number.isSafeInteger(value.epoch) && value.epoch >= 0 &&
    (value.owner === null || ["hamlib", "native_dcu1"].includes(value.owner)) &&
    (value.generation === null || Number.isSafeInteger(value.generation) && value.generation >= 0) &&
    typeof value.activation_pending === "boolean" && typeof value.canonical_pending === "boolean" && typeof value.error === "string";
}
export function useAutoRotor() {
  const [state, setState] = useState<AutomaticRotorState | null>(null), [error, setError] = useState("");
  const latest = useRef<AutomaticRotorState | null>(null), active = useRef(false), reading = useRef(false);
  const lifecycle = useRef(0), readEpoch = useRef(0), again = useRef(false);
  const adopt = (value: unknown) => {
    if (!valid(value)) throw new Error("Native automatic rotor status could not be verified.");
    if (active.current && (!latest.current || value.epoch >= latest.current.epoch)) { latest.current = value; setState(value); setError(value.error); }
  };
  const refresh = async () => {
    if (!active.current || reading.current || !isTauri()) return;
    reading.current = true;
    const mount = lifecycle.current;
    try {
      do {
        again.current = false; const captured = readEpoch.current;
        try { const value = await invoke("auto_rotor_snapshot"); if (active.current && mount === lifecycle.current && captured === readEpoch.current) adopt(value); }
        catch (cause) { if (active.current && mount === lifecycle.current && captured === readEpoch.current) setError(cause instanceof Error ? cause.message : "Native automatic rotor status unavailable."); }
      } while (active.current && mount === lifecycle.current && again.current);
    } finally { reading.current = false; }
  };
  useEffect(() => {
    const mount = ++lifecycle.current; let mounted = true;
    active.current = true;
    if (!isTauri()) return () => { active.current = false; lifecycle.current++; };
    const stops: Array<() => void> = [];
    const wake = () => { readEpoch.current++; again.current = true; void refresh(); };
    void Promise.allSettled(["xlog:auto-rotor", "xlog:rotor-telemetry"].map(event => listen(event, wake))).then(results => {
      results.forEach(result => { if (result.status === "fulfilled") { if (mounted) stops.push(result.value); else result.value(); } });
      if (mounted) void refresh();
    });
    window.addEventListener("focus", wake); const timer = setInterval(() => void refresh(), 1500);
    return () => { mounted = false; if (mount === lifecycle.current) { active.current = false; lifecycle.current++; } stops.forEach(stop => stop()); clearInterval(timer); window.removeEventListener("focus", wake); };
  }, []);
  return { state, error, refresh, async set(armed: boolean, rotor?: RotorSnapshot | null) {
    if (!isTauri()) throw new Error("Automatic rotor control requires the native station owner.");
    if (armed && (!rotor?.owner || !Number.isSafeInteger(rotor.generation))) throw new Error("Observe the current rotor owner before arming automatic motion.");
    const mount = lifecycle.current;
    const value = await invoke("auto_rotor_set", armed ? { armed, owner: rotor!.owner, generation: rotor!.generation } : { armed });
    if (active.current && mount === lifecycle.current) adopt(value);
  } };
}
