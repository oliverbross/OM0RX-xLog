import { useCallback, useEffect, useRef, useState } from "react";
import { requestCWDecode, type CWDecodeMethod, type CWDecodeSnapshot } from "./cwDecode";

/** Independent views read the same native owner. Mount/unmount never starts or
 * stops capture. Reads cannot overwrite a completed mutation with older state. */
export function useCWDecode(request: typeof requestCWDecode = requestCWDecode) {
  const [snapshot, setSnapshot] = useState<CWDecodeSnapshot | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const active = useRef(false), reading = useRef(false), mutation = useRef(false), revision = useRef(0);
  const commandFailed = useRef(false);
  const refresh = useCallback(async () => {
    if (reading.current || mutation.current || !active.current) return;
    reading.current = true; const order = revision.current;
    try { const next = await request("cw_decode_snapshot"); if (active.current && order === revision.current) { setSnapshot(next); if (!commandFailed.current) setError(""); } }
    catch (cause) { if (active.current && order === revision.current) { setSnapshot(null); setError(cause instanceof Error ? cause.message : "CW Decode is unavailable. Retry to read its state."); } }
    finally { reading.current = false; }
  }, [request]);
  const command = useCallback(async (method: Exclude<CWDecodeMethod, "cw_decode_snapshot">, params: Record<string, unknown> = {}) => {
    const stop = method === "cw_decode_stop" || method === "cw_decode_source_stop" || method === "cw_decode_listener_stop";
    if (mutation.current && !stop) return false;
    mutation.current = true; commandFailed.current = false; const order = ++revision.current; setBusy(true); setError("");
    try { const next = await request(method, params); if (active.current && order === revision.current) setSnapshot(next); return true; }
    catch (cause) { if (active.current && order === revision.current) { commandFailed.current = true; setError(cause instanceof Error ? cause.message : "The CW Decode request could not be confirmed. Read its state before retrying."); } return false; }
    finally { if (order === revision.current) { mutation.current = false; if (active.current) { setBusy(false); void refresh(); } } }
  }, [request, refresh]);
  useEffect(() => {
    active.current = true; void refresh();
    const timer = window.setInterval(() => void refresh(), 750), focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => { active.current = false; revision.current++; window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [refresh]);
  const retry = useCallback(async () => { commandFailed.current = false; await refresh(); }, [refresh]);
  return { snapshot, error, busy, refresh: retry, command };
}
