import { invoke } from "@tauri-apps/api/core";
import { ManualTuneSession, manualTuneJournal } from "./manualTune";
import type { RadioID, StationSession, StationReceipt } from "./stationSession";
const request = <T,>(params: Record<string, unknown>) => invoke<T>("band_map_marker_tune", { params });
export const loadGuideStation = (radioId: RadioID) => request<StationSession>({ action: "snapshot", radio_id: radioId });
const sessions = new Map<string, ManualTuneSession>();
let active: ManualTuneSession | null = null;
const listeners = new Set<() => void>();
const idle = { pending: null, busy: false, message: "", reviewable: false };
export const guideTuneRecovery = {
  subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => active?.getSnapshot() ?? idle,
  check: () => active?.check() ?? Promise.resolve(),
  review: () => active?.review() ?? Promise.resolve(),
};
export function guideTuneSession(radioId: RadioID, explicitMode?: string) {
  const key = `${radioId}|${explicitMode ?? "keep"}`;
  let session = sessions.get(key);
  if (!session) {
    session = new ManualTuneSession({ snapshot: () => loadGuideStation(radioId), request: params => request<StationReceipt>({ ...params, radio_id: radioId, ...(params.action === "manual_tune" ? { guide_marker_mode: explicitMode ?? null } : {}) }) }, manualTuneJournal(radioId));
    sessions.set(key, session);
    session.subscribe(() => listeners.forEach(listener => listener()));
  }
  if (active !== session) { active = session; listeners.forEach(listener => listener()); }
  return session;
}
