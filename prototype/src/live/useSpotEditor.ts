import { useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { connectSpotEditor } from "./spotEditorRegistration";
import type { SpotActivationSnapshot, SpotEditorParticipant } from "./spotActivation";
import type { SpotEditorReadiness } from "./spotActivationBarrier";

export const nativeSpotEditor = () => isTauri();
export function useSpotEditor(participants: readonly SpotEditorParticipant[], readiness: () => SpotEditorReadiness) {
  const members = useRef(participants), ready = useRef(readiness); ready.current = readiness;
  const [status, setStatus] = useState<SpotActivationSnapshot | null>(null), [error, setError] = useState("");
  const current = useRef<ReturnType<typeof connectSpotEditor> | null>(null), disposal = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!nativeSpotEditor()) return;
    let active = true;
    const connection = connectSpotEditor(members.current, () => ready.current(), snapshot => { if (active) { setStatus(snapshot); setError(""); } },
      message => { if (active) setError(message); }, undefined, disposal.current);
    current.current = connection;
    return () => { active = false; current.current = null; disposal.current = connection.dispose(); };
  }, []);
  return { status, error, reconcile: async () => {
    try { await current.current?.reconcile(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Activation status could not be checked. No tune was replayed."); }
  } };
}
