import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { hamlibProjection } from "./hamlibStation";
import { rotorCommandParams, rotorProjection, validRotorSnapshot, type RotorSnapshot } from "./rotorControl";
import { manualRotorGotoSession } from "./manualRotorGoto";
import { radioReleaseSession } from "./radioRelease";
import { carrierTuneSession } from "./carrierTune";
import { amplifierTransitionSession } from "./amplifierTransition";

type Data = Record<string, any>;
export type MonitorContext = { epoch: string; revision: number; selection: null | {
  provider: "direct_agent" | "direct_flex_lan" | "hamlib" | null; generation: number; selection_id: string | null; control_revision?: number;
}; radio: Data; rotor: Data; acceptance?: { synthetic: true; source: "synthetic_memory"; externalOwners: false; readOnly: true } };
const object = (value: any) => !!value && typeof value === "object" && !Array.isArray(value);
const integer = (value: any) => Number.isSafeInteger(value) && value >= 0;
const uuid = (value: any) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const providers = ["direct_agent", "direct_flex_lan", "hamlib"];
function projection(value: any, rotor = false) {
  return object(value) && typeof value.available === "boolean" && Object.hasOwn(value, "snapshot") &&
    (!value.available || integer(value.revision) && integer(value.received_at_ms) && object(value.snapshot)
      && (rotor ? validRotorSnapshot(value.snapshot) : providers.includes(value.provider)));
}
export function validMonitorContext(value: any): value is MonitorContext {
  const selection = value?.selection, proof = value?.acceptance;
  return object(value) && uuid(value.epoch) && integer(value.revision) &&
    (selection === null || object(selection) && integer(selection.generation) &&
      (selection.provider === null && selection.selection_id === null || providers.includes(selection.provider) && uuid(selection.selection_id))) &&
    projection(value.radio) && projection(value.rotor, true) &&
    (proof === undefined || object(proof) && proof.synthetic === true && proof.source === "synthetic_memory" && proof.externalOwners === false && proof.readOnly === true);
}
export function freshMonitorProjection(value: Data | undefined, now = Date.now()) {
  return !!value?.available && integer(value.received_at_ms) && now - value.received_at_ms >= -1000 && now - value.received_at_ms <= 5000;
}
export function monitorRadioFresh(context: MonitorContext | null, now = Date.now()): boolean {
  const radio = context?.radio, provider = context?.selection?.provider;
  if (!provider || radio?.provider !== provider || radio.selection_id !== context?.selection?.selection_id ||
      radio.selection_generation !== context?.selection?.generation || !freshMonitorProjection(radio, now)) return false;
  const snapshot = provider === "hamlib" ? hamlibProjection(radio!.snapshot, null) : radio!.snapshot;
  const generated = snapshot?.generated_at;
  return snapshot?.source === provider && snapshot.radio?.connected === true && snapshot.radio?.observed === true && snapshot.station?.radio_stale !== true &&
    (generated === undefined || typeof generated === "number" && Number.isFinite(generated) && Math.abs(now - generated * 1000) <= 5000);
}
export function monitorStation(context: MonitorContext | null, now = Date.now()) {
  const provider = context?.selection?.provider;
  const input = context?.radio?.provider === provider ? context?.radio?.snapshot : null;
  const snapshot = provider === "hamlib" ? hamlibProjection(input, null) : input;
  const fresh = monitorRadioFresh(context, now), rotorFresh = freshMonitorProjection(context?.rotor, now);
  const rotor = validRotorSnapshot(context?.rotor?.snapshot) ? rotorProjection(context!.rotor.snapshot) : { connected: false };
  return { ...(snapshot ?? {}), source: provider ?? "unselected",
    radio: { ...(snapshot?.radio ?? {}), observed: fresh && snapshot?.radio?.observed === true },
    station: { ...(snapshot?.station ?? {}), radio_stale: !fresh, swr_is_live: fresh && snapshot?.station?.swr_is_live === true },
    rotor: { ...rotor, connected: rotorFresh && rotor.connected === true } };
}
type Invoke = (command: string, params?: Data) => Promise<any>;
export async function monitorRadioAction(context: MonitorContext | null, action: unknown, call: Invoke = invoke) {
  if (!context?.selection?.provider || context.acceptance || typeof action !== "string" || !["direct_agent", "direct_flex_lan"].includes(context.selection.provider) ||
      action !== "cancel" && action !== "standby" && !monitorRadioFresh(context)) throw new Error("Refresh a current native radio observation before using monitor controls.");
  if (action === "cancel") return radioReleaseSession().cancel(context.selection!.provider as "direct_agent" | "direct_flex_lan", context);
  if (action === "operate" || action === "standby") {
    if(context.selection.provider!=="direct_agent")throw new Error("Amplifier controls require the Agent.");
    return amplifierTransitionSession().transition(action,context);
  }
  const selection = context.selection!, snapshot = context.radio.snapshot ?? {};
  const allowed = selection.provider === "direct_agent" ? snapshot.station?.allowed_actions : snapshot.capabilities?.supported_commands;
  if (action !== "cancel" && (!["operate", "standby", "tune"].includes(action) || !Array.isArray(allowed) || !allowed.includes(action) ||
      selection.provider === "hamlib" || selection.provider === "direct_flex_lan" && !["tune", "cancel"].includes(action) ||
      action === "tune" && snapshot.allow_transmit !== true)) throw new Error("This station action is unavailable or transmit was not enabled.");
  if(action === "tune") return carrierTuneSession().tune(selection.provider as "direct_agent" | "direct_flex_lan", context);
  const reply = await call("monitor_station_action", { expected: selection.generation, selectionId: selection.selection_id, provider: selection.provider, action });
  if (reply?.ok !== true || reply.result?.accepted !== true) throw new Error(reply?.error?.message || "The station action was not accepted. Check observed state before retrying.");
  return reply.result;
}
export async function monitorRotorAction(context: MonitorContext | null, method: string, params: Data = {},
  request: (method: string, params?: Data) => Promise<any> = async (method, params = {}) => {
    if (method !== "rotor_goto") throw new Error("Unsupported manual rotor operation.");
    return manualRotorGotoSession().goto(params.owner, params.generation, params.bearing, String(params.label ?? "Monitor bearing"));
  },
  stop: (owner: string) => Promise<any> = async owner => {
    const reply: any = await invoke("monitor_rotor_stop", { owner });
    if (reply?.ok !== true || !object(reply.result)) throw new Error(reply?.error?.message || "Stop was not acknowledged; check observed state before retrying.");
    return reply.result;
  }) {
  const captured = context?.rotor?.snapshot;
  if (!context || context.acceptance || method !== "rotor_stop" && !freshMonitorProjection(context.rotor) || !validRotorSnapshot(captured) || !captured.owner ||
      !["rotor_goto", "rotor_stop"].includes(method)) throw new Error("Refresh the independent rotor observation before using its controls.");
  if (method === "rotor_stop") return stop(captured.owner);
  if (!rotorProjection(captured).connected || typeof params.bearing !== "number" || !Number.isFinite(params.bearing) || params.bearing < 0 || params.bearing > 360)
    throw new Error("An observed rotor and a bearing from 0° to 360° are required.");
  return request(method, rotorCommandParams(captured, { bearing: params.bearing, label: "Monitor bearing" }));
}

type Adapter = { read: () => Promise<any>; listen: (name: string, wake: () => void) => Promise<() => void> };
export function connectMonitorContext(changed: (value: MonitorContext) => void, failed: (message: string) => void,
  adapter: Adapter = { read: () => invoke("monitor_context_snapshot"), listen: (name, wake) => listen(name, wake) }) {
  let active = true, reading = false, again = false, wakeEpoch = 0, latest: MonitorContext | null = null;
  const stops: (() => void)[] = [];
  const recover = async () => {
    if (!active) return;
    if (reading) { again = true; return; }
    reading = true;
    do {
      again = false; const captured = wakeEpoch;
      try {
        const value = await adapter.read();
        if (active && captured === wakeEpoch) {
          if (!validMonitorContext(value)) throw new Error("Station Monitor context could not be verified. Refresh to retry.");
          if (!latest || value.epoch !== latest.epoch || value.revision > latest.revision) { latest = value; changed(value); }
        }
      } catch (cause) { if (active && captured === wakeEpoch) failed(cause instanceof Error ? cause.message : "Station Monitor updates unavailable. Refresh to retry."); }
    } while (active && again);
    reading = false;
  };
  const wake = () => { wakeEpoch++; void recover(); };
  window.addEventListener("focus", wake);
  const timer = window.setInterval(() => void recover(), 1500);
  void Promise.allSettled(["xlog:station-selection", "xlog:station-telemetry", "xlog:rotor-telemetry"].map(name => adapter.listen(name, wake))).then(results => {
    for (const result of results) if (result.status === "fulfilled") { if (active) stops.push(result.value); else result.value(); }
    if (active) { if (results.some(result => result.status === "rejected")) failed("Some monitor notifications are unavailable; retained reads continue."); void recover(); }
  });
  return { refresh: wake, dispose: () => { active = false; wakeEpoch++; stops.forEach(stop => stop()); clearInterval(timer); window.removeEventListener("focus", wake); } };
}
