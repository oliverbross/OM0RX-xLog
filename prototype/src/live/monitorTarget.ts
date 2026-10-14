import { workerRequest } from "../worker";
import { requestOperatorDraft } from "./operatorDraftTransport";
import { connectOperatorDraftChanges } from "./operatorDraftWindows";
import { CanonicalDraftFollower, CallsignLookupCache, intelligenceIdentity } from "./callsignIntelligenceContext";

export type MonitorTarget = { generation: string; call: string; lat: number; lon: number; country?: string; locationSource?: string };
type Request = (method: string, params?: Record<string, any>) => Promise<any>;
async function read(method: string, params: Record<string, any> = {}) {
  if (method === "logbook_operator_draft") return requestOperatorDraft(method, params);
  if (method === "lookup_call") return (await workerRequest(method, params)).result;
  throw new Error("Monitor target reads only the shared draft and matched lookup.");
}
/** Optional display context only. Failure cannot block station/rotor controls. */
export function connectMonitorTarget(changed: (value: MonitorTarget | null) => void, failed: (message: string) => void,
  request: Request = read, connect = connectOperatorDraftChanges) {
  const follower = new CanonicalDraftFollower(() => request("logbook_operator_draft", {})), cache = new CallsignLookupCache(request);
  let active = true, key = "";
  follower.activate();
  const observe = () => {
    const state = follower.getSnapshot(), draft = state.available ? state.snapshot : null, identity = intelligenceIdentity(draft);
    if (identity === key) return;
    key = identity; changed(null);
    const call = String(draft?.qso.call ?? "").trim().toUpperCase();
    if (!draft || !/^[A-Z0-9/-]{3,32}$/.test(call)) return;
    void cache.lookup(identity, call).then(profile => {
      if (!active || identity !== key) return;
      if (!Number.isFinite(profile.latitude) || Math.abs(profile.latitude) > 90 || !Number.isFinite(profile.longitude) || Math.abs(profile.longitude) > 180) return;
      changed({ generation: draft.generation!, call, lat: profile.latitude, lon: profile.longitude, country: profile.country, locationSource: profile.location_source || profile.source });
    }).catch(() => { if (active && identity === key) failed("Shared QSO map target unavailable. Station and rotor remain independent."); });
  };
  const unsubscribe = follower.subscribe(observe);
  const stop = connect(follower.refresh, message => { if (active) { key = ""; changed(null); failed(message); } });
  return { refresh: () => { cache.invalidate(key); key = ""; void follower.refresh().catch(cause => { if (active) { changed(null); failed(cause instanceof Error ? cause.message : "Shared map target unavailable."); } }); },
    dispose: () => { active = false; stop(); unsubscribe(); follower.dispose(); } };
}
