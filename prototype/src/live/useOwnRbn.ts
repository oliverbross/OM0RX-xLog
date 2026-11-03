import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { loadOwnRBNPickups, type OwnRBNTransport } from "./ownRbnFeed";
import { useDocumentVisible } from "./useDocumentVisible";
import type { OwnRBNSpot } from "./hfPropagationModel";
import { ownRbnClockMilliseconds, ownRbnRefreshMilliseconds } from "./ownRbnPolicy";
export const nativeOwnRbnTransport: OwnRBNTransport = (source, parameters = {}) => {
  if (!isTauri()) return Promise.reject(new Error("RBN requires the desktop app."));
  return invoke("hf_propagation_fetch", { request: { source, ...parameters } });
};
export function useOwnRbn(call: string, enabled: boolean, context: string, transport = nativeOwnRbnTransport) {
  const visible = useDocumentVisible();
  const [state, setState] = useState<{ key: string; spots: OwnRBNSpot[]; status: string; error: string }>({ key: "", spots: [], status: "Disabled", error: "" });
  const [now, setNow] = useState(Date.now());
  const key = `${context}|${call}`;
  useEffect(() => {
    if (!enabled || !visible || !call.trim()) return;
    let active = true;
    setNow(Date.now());
    setState({ key, spots: [], status: "Loading", error: "" });
    const read = async () => {
      try {
        const spots = await loadOwnRBNPickups(transport, call, ownRbnRefreshMilliseconds);
        if (active) setState({ key, spots, status: "Current", error: "" });
      } catch (cause) {
        if (active) setState(prior => ({ key, spots: prior.key === key ? prior.spots : [], status: "Unavailable", error: String(cause) }));
      }
    };
    void read();
    const refresh = setInterval(read, ownRbnRefreshMilliseconds), clock = setInterval(() => setNow(Date.now()), ownRbnClockMilliseconds);
    return () => { active = false; clearInterval(refresh); clearInterval(clock); };
  }, [key, call, enabled, visible, transport]);
  return { ...state, spots: enabled && state.key === key ? state.spots : [], now, status: !enabled ? "Disabled" : !call.trim() ? "Set a station callsign" : state.key !== key ? "Loading" : state.status };
}
