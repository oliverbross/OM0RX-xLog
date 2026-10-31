import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SpotActivationClient } from "./spotActivationClient";

export function useSpotActivation(command: "activate_spot" | "activate_opportunity" = "activate_spot") {
  const client = useRef<SpotActivationClient | null>(null);
  const [state, setState] = useState(() => new SpotActivationClient(invoke).getSnapshot());
  useEffect(() => {
    const current = new SpotActivationClient(invoke, undefined, command); client.current = current;
    const unsubscribe = current.subscribe(() => setState(current.getSnapshot()));
    let active = true, stop: (() => void) | undefined;
    const refresh = () => { void current.refresh(); };
    if (isTauri()) {
      void listen("xlog:spot-activation", refresh).then(dispose => { if (active) { stop = dispose; refresh(); } else dispose(); }).catch(refresh);
      window.addEventListener("focus", refresh);
    }
    const timer = isTauri() ? window.setInterval(refresh, 1500) : undefined;
    return () => { active = false; unsubscribe(); stop?.(); clearInterval(timer); window.removeEventListener("focus", refresh); current.dispose(); client.current = null; };
  }, [command]);
  return { ...state, activate: async (spot: Record<string, any>) => {
    if (!client.current) throw new Error("Wait for spot activation to initialize.");
    return client.current.activate(spot);
  }, canActivate: () => client.current?.canActivate() === true,
    supersedeRotor: () => client.current?.supersedeRotor() ?? Promise.resolve(),
    reconcile: () => client.current?.reconcile(), retire: () => client.current?.retire() };
}
