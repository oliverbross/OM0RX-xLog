import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import type { ContestSetupCatalogEntry, ContestSetupDocument } from "./ContestSetupPanel";

export type SetupDialogKind = "operator" | "station" | "configuration" | "digital" | "macros" | "keys" | "rover" | "about";
export type ContestDigitalSnapshot = { configuration: { enabled: boolean; address: string; port: number;
    destination: "ordinary_logbook" | "active_contest" };
  running: boolean; status: string; receive_only: boolean; contest_target_supported: boolean;
  active_contest?: { session_id: string; plugin_id: string } | null;
  fldigi?: { configuration: { receive_enabled: boolean; transmit_enabled: boolean };
    receive_supported: boolean; transmit_supported: boolean; receive_running: boolean; status: string;
    udp_endpoint: string; xmlrpc_endpoint: string } };
export type ContestDigitalSave = { configuration: ContestDigitalSnapshot["configuration"];
  fldigi_configuration?: { receive_enabled: boolean; transmit_enabled: boolean }; action: "save" | "start" | "stop" };
export type SetupDialogAuxiliary = { roverLocation: string; activeSessionID?: string; effectiveMacros?: ContestSetupDocument["macros"];
  catalog?: ContestSetupCatalogEntry[];
  diagnostics: { engine: string; plugin: string; version: string; source: string; reference: string };
  digital?: ContestDigitalSnapshot };
export type SetupDialogSnapshot = { epoch: string; context: string; revision: number; document: ContestSetupDocument; auxiliary: SetupDialogAuxiliary };
type SaveRequest = SetupDialogSnapshot & { requestID: string; kind: SetupDialogKind; baseDocument?: ContestSetupDocument;
  baseAuxiliary?: SetupDialogAuxiliary; roverLocation?: string; digital?: ContestDigitalSave };
type Receipt = { requestID: string; status: "pending" | "saved" | "rejected"; message?: string };
export const setupDialogRequest = <T,>(method: string, params: unknown = {}): Promise<T> =>
  invoke("contest_setup_dialog_request", { method, params });
export async function openContestSetupDialog(kind: SetupDialogKind) {
  if (!isTauri()) throw new Error("Contest setup dialogs require the native application.");
  await invoke("contest_setup_dialog_open", { kind });
}
export const closeContestSetupDialog = () => setupDialogRequest<void>("close");

export async function saveContestRoverDialog(snapshot: SetupDialogSnapshot, roverLocation: string): Promise<void> {
  return submitContestSetupDialog(snapshot, { roverLocation: roverLocation.trim().toUpperCase() });
}
export async function saveContestDigitalDialog(snapshot: SetupDialogSnapshot, digital: ContestDigitalSave): Promise<void> {
  return submitContestSetupDialog(snapshot, { digital });
}

/** Only apply the fields owned by this form, preserving the other dialog's data. */
export function mergeSetupDialog(current: ContestSetupDocument, requested: ContestSetupDocument, kind: SetupDialogKind): ContestSetupDocument {
  if (kind === "operator") return { ...current, operator: requested.operator };
  if (kind === "macros") return { ...current, macros: structuredClone(requested.macros) };
  if (kind === "keys") return { ...current, preferences: { ...current.preferences, keyBindings: requested.preferences.keyBindings } };
  return kind === "station" ? { ...current, station: structuredClone(requested.station) } :
    { ...current, preferences: structuredClone(requested.preferences), network: structuredClone(requested.network) };
}

function dialogOwnedState(snapshot: SetupDialogSnapshot, kind: SetupDialogKind): unknown {
  if (kind === "operator") return snapshot.document.operator;
  if (kind === "station") return snapshot.document.station;
  if (kind === "macros") return snapshot.document.macros;
  if (kind === "keys") return snapshot.document.preferences.keyBindings;
  if (kind === "rover") return snapshot.auxiliary.roverLocation;
  if (kind === "digital") {
    const value=snapshot.auxiliary.digital;
    if (!value) return null;
    // Native JSON key order and changing status text are not configuration changes.
    return {configuration:{enabled:value.configuration.enabled,address:value.configuration.address,port:value.configuration.port,destination:value.configuration.destination},
      running:value.running,receive_only:value.receive_only,contest_target_supported:value.contest_target_supported,
      active_contest:value.active_contest?{session_id:value.active_contest.session_id,plugin_id:value.active_contest.plugin_id}:null,
      fldigi:value.fldigi?{configuration:{receive_enabled:value.fldigi.configuration.receive_enabled,transmit_enabled:value.fldigi.configuration.transmit_enabled},
        receive_supported:value.fldigi.receive_supported,transmit_supported:value.fldigi.transmit_supported,receive_running:value.fldigi.receive_running}:null};
  }
  return { preferences: snapshot.document.preferences, network: snapshot.document.network };
}

const errorMessage = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message :
  typeof cause === "string" && cause.trim() ? cause : fallback;

async function submitContestSetupDialog(snapshot: SetupDialogSnapshot, payload: { document?: ContestSetupDocument; roverLocation?: string; digital?: ContestDigitalSave }): Promise<void> {
  const requestID = crypto.randomUUID();
  let receipt: Receipt = { requestID, status: "pending" };
  try { receipt = await setupDialogRequest<Receipt>("submit", { ...snapshot, ...payload, requestID,
    baseDocument: snapshot.document, baseAuxiliary: snapshot.auxiliary }); }
  catch (submitError) {
    // A command rejection and a lost IPC reply both reject the promise. The
    // mailbox exposes queued requests as pending, so reconcile briefly before
    // treating this as a definite pre-admission failure. Never resend.
    let admitted = false;
    for (let attempt = 0; attempt < 3 && !admitted; attempt++) {
      try {
        const known = await setupDialogRequest<Receipt | null>("receipt", { requestID });
        if (known) { receipt = known; admitted = true; }
      } catch { /* Retry the read, never the save. */ }
      if (!admitted && attempt < 2) await new Promise(resolve => setTimeout(resolve, 120));
    }
    if (!admitted) throw submitError;
  }
  // Never resend a save after an uncertain result; the owner/native mailbox deduplicates it.
  const deadline = Date.now() + 30_000;
  while (receipt.status === "pending") {
    if (Date.now() > deadline) throw new Error("Save confirmation timed out. Reopen the dialog to inspect saved settings before retrying.");
    await new Promise(resolve => setTimeout(resolve, 120));
    try { receipt = await setupDialogRequest<Receipt | null>("receipt", { requestID }) ?? receipt; }
    catch { /* Keep reconciling the same uncertain request until the bounded deadline. */ }
  }
  if (receipt.status !== "saved") throw new Error(receipt.message || "Setup changed. Reopen the dialog before saving.");
}
export async function saveContestSetupDialog(snapshot: SetupDialogSnapshot, document: ContestSetupDocument): Promise<void> {
  return submitContestSetupDialog(snapshot, { document });
}

export function useContestSetupDialogs(options: { enabled: boolean; context: string; document: ContestSetupDocument; auxiliary: SetupDialogAuxiliary;
  save: (document: ContestSetupDocument) => Promise<void>; saveRover: (location: string) => Promise<void>;
  saveDigital?: (digital: ContestDigitalSave) => Promise<void>; report: (message: string) => void }) {
  const latest = useRef(options); latest.current = options;
  useEffect(() => {
    if (!options.enabled || !isTauri()) return;
    const epoch = crypto.randomUUID();
    let active = true, timer: ReturnType<typeof setTimeout>;
    const completed = new Map<string, { requestID: string; epoch: string; ok: boolean; message: string }>();
    const tick = async () => {
      try {
        const source = latest.current;
        await setupDialogRequest("publish", { epoch, context: source.context, document: source.document, auxiliary: source.auxiliary });
        if (!active) return;
        const pending = await setupDialogRequest<SaveRequest | null>("next", { epoch });
        if (pending && active) {
          let result = completed.get(pending.requestID);
          if (!result) {
            result = { requestID: pending.requestID, epoch, ok: false, message: "" };
            try {
              const current = latest.current;
              const baseline: SetupDialogSnapshot = { epoch: pending.epoch, context: pending.context, revision: pending.revision,
                document: pending.baseDocument ?? pending.document, auxiliary: pending.baseAuxiliary ?? pending.auxiliary };
              const currentSnapshot: SetupDialogSnapshot = { epoch, context: current.context, revision: pending.revision,
                document: current.document, auxiliary: current.auxiliary };
              if (pending.context !== current.context ||
                  JSON.stringify(dialogOwnedState(baseline, pending.kind)) !== JSON.stringify(dialogOwnedState(currentSnapshot, pending.kind)))
                throw new Error("Setup changed. Reopen the dialog before saving.");
              if (pending.kind === "rover") await latest.current.saveRover(pending.roverLocation ?? "");
              else if (pending.kind === "digital") {
                if (!pending.digital || !latest.current.saveDigital) throw new Error("Digital logging settings are unavailable.");
                await latest.current.saveDigital(pending.digital);
              }
              else await latest.current.save(mergeSetupDialog(latest.current.document, pending.document, pending.kind));
              result.ok = true;
            } catch (cause) { result.message = errorMessage(cause, "Setup could not be saved."); }
            completed.set(pending.requestID, result);
          }
          await setupDialogRequest("complete", result);
        }
      } catch (cause) { if (active) latest.current.report(errorMessage(cause, "Setup dialogs are unavailable.")); }
      finally { if (active) timer = setTimeout(() => void tick(), 200); }
    };
    void tick();
    return () => { active = false; clearTimeout(timer); void setupDialogRequest("revoke", { epoch }).catch(() => {}); };
  }, [options.enabled]);
}
