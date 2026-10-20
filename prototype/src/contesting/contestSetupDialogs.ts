import { invoke, isTauri } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import type { ContestSetupDocument } from "./ContestSetupPanel";

export type SetupDialogKind = "operator" | "station" | "configuration" | "rover" | "about";
export type SetupDialogAuxiliary = { roverLocation: string; diagnostics: { engine: string; plugin: string; version: string; source: string; reference: string } };
export type SetupDialogSnapshot = { epoch: string; context: string; revision: number; document: ContestSetupDocument; auxiliary: SetupDialogAuxiliary };
type SaveRequest = SetupDialogSnapshot & { requestID: string; kind: SetupDialogKind; roverLocation?: string };
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

/** Only apply the fields owned by this form, preserving the other dialog's data. */
export function mergeSetupDialog(current: ContestSetupDocument, requested: ContestSetupDocument, kind: SetupDialogKind): ContestSetupDocument {
  if (kind === "operator") return { ...current, operator: requested.operator };
  return kind === "station" ? { ...current, station: structuredClone(requested.station) } :
    { ...current, preferences: structuredClone(requested.preferences), network: structuredClone(requested.network) };
}

async function submitContestSetupDialog(snapshot: SetupDialogSnapshot, payload: { document?: ContestSetupDocument; roverLocation?: string }): Promise<void> {
  const requestID = crypto.randomUUID();
  let receipt: Receipt = { requestID, status: "pending" };
  try { receipt = await setupDialogRequest<Receipt>("submit", { ...snapshot, ...payload, requestID }); }
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
  save: (document: ContestSetupDocument) => Promise<void>; saveRover: (location: string) => Promise<void>; report: (message: string) => void }) {
  const latest = useRef(options); latest.current = options;
  useEffect(() => {
    if (!options.enabled || !isTauri()) return;
    const epoch = crypto.randomUUID();
    let active = true, timer: ReturnType<typeof setTimeout>;
    const completed = new Map<string, { requestID: string; epoch: string; ok: boolean; message: string }>();
    const tick = async () => {
      try {
        const source = latest.current;
        const published = JSON.stringify({ context: source.context, document: source.document, auxiliary: source.auxiliary });
        await setupDialogRequest("publish", { epoch, context: source.context, document: source.document, auxiliary: source.auxiliary });
        if (!active) return;
        const pending = await setupDialogRequest<SaveRequest | null>("next", { epoch });
        if (pending && active) {
          let result = completed.get(pending.requestID);
          if (!result) {
            result = { requestID: pending.requestID, epoch, ok: false, message: "" };
            try {
              if (published !== JSON.stringify({ context: latest.current.context, document: latest.current.document, auxiliary: latest.current.auxiliary })) throw new Error("Setup changed. Reopen the dialog before saving.");
              if (pending.kind === "rover") await latest.current.saveRover(pending.roverLocation ?? "");
              else await latest.current.save(mergeSetupDialog(latest.current.document, pending.document, pending.kind));
              result.ok = true;
            } catch (cause) { result.message = cause instanceof Error ? cause.message : "Setup could not be saved."; }
            completed.set(pending.requestID, result);
          }
          await setupDialogRequest("complete", result);
        }
      } catch (cause) { if (active) latest.current.report(cause instanceof Error ? cause.message : "Setup dialogs are unavailable."); }
      finally { if (active) timer = setTimeout(() => void tick(), 200); }
    };
    void tick();
    return () => { active = false; clearTimeout(timer); void setupDialogRequest("revoke", { epoch }).catch(() => {}); };
  }, [options.enabled]);
}
