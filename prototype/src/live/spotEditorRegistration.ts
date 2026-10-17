import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { SpotActivationEditor, type SpotActivationSnapshot, type SpotEditorParticipant } from "./spotActivation";
import type { SpotEditorReadiness } from "./spotActivationBarrier";

type Adapter = { call: (command: string, params?: Record<string, unknown>) => Promise<any>;
  listen: (wake: () => void) => Promise<() => void> };
const native: Adapter = { call: invoke, listen: wake => listen("xlog:spot-activation", wake) };
/** Each registration lifetime gets a nonce. Cleanup waits for its own register
 * reply before unregistering; a StrictMode remount may await disposed below. */
export function connectSpotEditor(participants: readonly SpotEditorParticipant[], readiness: (snapshot: SpotActivationSnapshot) => SpotEditorReadiness,
  changed: (snapshot: SpotActivationSnapshot) => void, failed: (message: string) => void,
  adapter: Adapter = native, before: Promise<unknown> = Promise.resolve(), instance: string = crypto.randomUUID()) {
  const editor = new SpotActivationEditor(participants, () => adapter.call("spot_editor_state"), readiness);
  let active = true, started = false, registered = false, registering = false, reading = false, again = false, epoch = 0;
  let stop: (() => void) | undefined;
  const acknowledgements = new Set<string>();
  const followSettlements = new Set<string>();
  const adopt = async (snapshot: unknown, registration = false) => {
    const acknowledgement = registration ? editor.registeredWith(snapshot) : editor.observe(snapshot);
    // The pure coordinator synchronously freezes before this first await.
    const ack = await acknowledgement;
    if (!active) return;
    const status = snapshot as SpotActivationSnapshot;
    changed(status);
    const key = ack ? `${ack.operationId}:${ack.barrierId}` : "";
    if (ack && !acknowledgements.has(key)) {
      acknowledgements.add(key);
      await adapter.call("spot_editor_ack", { instance, ...ack });
      if (active) { again = true; }
    }
    if (status.phase !== "idle" && status.intent === "follow-radio" && status.phase === "confirmed" &&
        status.reservationActive !== true && !followSettlements.has(status.operationId)) {
      await adapter.call("operator_draft_follow_settled", { instance, operationId: status.operationId });
      followSettlements.add(status.operationId);
      if (active) again = true;
    }
  };
  const recover = async () => {
    if (!active) return;
    if (!registered) { void register(); return; }
    if (reading) { again = true; return; }
    reading = true;
    try {
      do {
        again = false; const captured = epoch;
        try {
          const snapshot = await adapter.call("spot_activation_snapshot");
          if (active && captured === epoch) await adopt(snapshot);
        } catch (cause) {
          if (active && captured === epoch) {
            registered = false; participants.forEach(participant => participant.setSpotEditorRegistered(false));
            failed(cause instanceof Error ? cause.message : "Spot activation status is unavailable. Keep this editor open and check its status.");
          }
        }
      } while (active && again);
    } finally { reading = false; }
  };
  const wake = () => { epoch++; void recover(); };
  window.addEventListener("focus", wake);
  const timer = window.setInterval(() => void recover(), 1500);
  let registration: Promise<void> = Promise.resolve();
  const register = () => {
    if (!active || registered || registering) return registration;
    registering = true;
    registration = (async () => {
      await before.catch(() => {});
      if (!active) return;
      if (!stop) {
        stop = await adapter.listen(wake);
        if (!active) { stop(); stop = undefined; return; }
      }
      // Even when the reply is lost, unregister this instance during disposal.
      started = true;
      const snapshot = await adapter.call("spot_editor_register", { instance });
      if (!active) return;
      await adopt(snapshot, true);
      registered = true;
      if (active) void recover();
    })().catch(cause => {
      if (active) {
        registered = false; participants.forEach(participant => participant.setSpotEditorRegistered(false));
        failed(`QSO editor registration is unavailable; retrying safely. Spot selection remains disabled and your draft is retained.${cause instanceof Error && cause.message ? ` ${cause.message}` : ""}`);
      }
    }).finally(() => { registering = false; });
    return registration;
  };
  void register();
  let disposal: Promise<void> | null = null;
  return {
    refresh: wake,
    async reconcile(recovered?: SpotActivationSnapshot): Promise<boolean> {
      const operationId = editor.operationId;
      if (!active || !registered) throw new Error("Editor registration is not confirmed. Reopen this editor before activating a spot.");
      epoch++;
      const snapshot = recovered ?? await adapter.call(operationId ? "spot_activation_reconcile" : "spot_activation_snapshot", operationId ? { operationId } : undefined);
      if (active) await adopt(snapshot);
      return active && registered && !editor.frozen;
    },
    dispose(): Promise<void> {
      if (disposal) return disposal;
      active = false; epoch++; editor.dispose(); clearInterval(timer); window.removeEventListener("focus", wake); stop?.(); stop = undefined;
      disposal = registration.then(async () => { if (started) await adapter.call("spot_editor_unregister", { instance }); }).catch(() => {});
      return disposal;
    },
  };
}
