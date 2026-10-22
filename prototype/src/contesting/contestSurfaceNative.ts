import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { contestSurfacePanelIDs, validContestSurfaceActionEnvelope, validContestSurfaceUUID,
  validContestSurfaceProjection, validateContestSurfaceActionEnvelope, type ContestSurfaceActionEnvelope,
  type ContestSurfacePanelID, type ContestSurfaceProjection } from "./contestSurfaceProtocol";

export const contestSurfaceEvent = "xlog:contest-surface";
export type ContestSurfaceContext = { operatingContext: string; sessionID: string; workspaceGeneration: string };
export type ContestSurfaceActionStatus = "queued" | "uncertain" | "applied" | "rejected";
export type ContestSurfaceActionReceipt = { requestID: string; status: ContestSurfaceActionStatus };
export type ContestSurfaceTerminalReceipt = ContestSurfaceActionReceipt & { message: string | null; projectionRevision: number };
export type ContestSurfaceSnapshot = ContestSurfaceContext & { scope: "contesting"; panelID: ContestSurfacePanelID;
  projectionRevision: number; projection: ContestSurfaceProjection; receipts: ContestSurfaceTerminalReceipt[] };
export type ContestSurfaceCompletion = ContestSurfaceContext & { requestID: string; outcome: "applied" | "rejected";
  message?: string; projectionRevision: number };
export type ContestSurfacePublication = ContestSurfaceContext & { scope: "contesting"; panelID: ContestSurfacePanelID;
  ownerEpoch: string; projectionRevision: number; projection: unknown };
export type ContestSurfaceOwnerClaim = ContestSurfaceContext & { ownerEpoch: string };
export type ContestRotorTarget = { available: boolean; projectionRevision: number; callsign: string | null;
  shortPathBearing: number | null; longPathBearing: number | null };

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value); return actual.length === keys.length && keys.every(key => actual.includes(key));
};
const uint = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const bytes = (value: string) => new TextEncoder().encode(value).length;
const contextValid = (value: ContestSurfaceContext) => validContestSurfaceUUID(value.operatingContext) &&
  validContestSurfaceUUID(value.sessionID) && validContestSurfaceUUID(value.workspaceGeneration);

export function contestSurfaceContextFromSearch(search: string): ContestSurfaceContext & { panelID: ContestSurfacePanelID } {
  const query = new URLSearchParams(search), single = (key: string) => query.getAll(key).length === 1 ? query.get(key) : null;
  const view = single("view"), panelID = view === "edit-contact" ? "logbook" : view;
  const context = { operatingContext: single("operatingContext"), sessionID: single("sessionID"),
    workspaceGeneration: single("workspaceGeneration") };
  if (single("scope") !== "contesting" || !contestSurfacePanelIDs.includes(panelID as ContestSurfacePanelID) ||
      !validContestSurfaceUUID(context.operatingContext) || !validContestSurfaceUUID(context.sessionID) ||
      !validContestSurfaceUUID(context.workspaceGeneration)) throw new Error("This contest surface context could not be verified.");
  return { operatingContext: context.operatingContext, sessionID: context.sessionID,
    workspaceGeneration: context.workspaceGeneration, panelID: panelID as ContestSurfacePanelID };
}

function actionReceipt(value: unknown): ContestSurfaceActionReceipt {
  const result = record(value) ? value : undefined;
  if (!result || !exact(result, ["requestID", "status"]) || !validContestSurfaceUUID(result.requestID) ||
      typeof result.status !== "string" || !["queued", "uncertain", "applied", "rejected"].includes(result.status))
    throw new Error("The contest surface action receipt could not be verified.");
  return result as ContestSurfaceActionReceipt;
}

function terminalReceipt(value: unknown): value is ContestSurfaceTerminalReceipt {
  const receipt = record(value) ? value : undefined;
  return !!receipt && exact(receipt, ["requestID", "status", "message", "projectionRevision"]) &&
    validContestSurfaceUUID(receipt.requestID) && typeof receipt.status === "string" &&
    ["queued", "uncertain", "applied", "rejected"].includes(receipt.status) &&
    (receipt.message === null || typeof receipt.message === "string" && bytes(receipt.message) <= 1024) && uint(receipt.projectionRevision);
}

function surfaceSnapshot(value: unknown, context: ContestSurfaceContext): ContestSurfaceSnapshot {
  const snapshot = record(value) ? value : undefined;
  const panelID = typeof snapshot?.panelID === "string" && contestSurfacePanelIDs.includes(snapshot.panelID as ContestSurfacePanelID)
    ? snapshot.panelID as ContestSurfacePanelID : undefined;
  if (!snapshot || !exact(snapshot, ["operatingContext", "scope", "sessionID", "workspaceGeneration", "panelID",
      "projectionRevision", "projection", "receipts"]) || snapshot.operatingContext !== context.operatingContext ||
      snapshot.scope !== "contesting" || snapshot.sessionID !== context.sessionID ||
      snapshot.workspaceGeneration !== context.workspaceGeneration || !panelID || !uint(snapshot.projectionRevision) ||
      !validContestSurfaceProjection(panelID, snapshot.projection) || !Array.isArray(snapshot.receipts) ||
      snapshot.receipts.length > 64 || !snapshot.receipts.every(terminalReceipt))
    throw new Error("The contest surface snapshot could not be verified.");
  return snapshot as unknown as ContestSurfaceSnapshot;
}

export async function submitContestSurfaceAction(action: ContestSurfaceActionEnvelope): Promise<ContestSurfaceActionReceipt> {
  validateContestSurfaceActionEnvelope(action);
  if (!isTauri()) throw new Error("Detached contest actions require the native application.");
  return actionReceipt(await invoke("contest_surface_action", { envelope: action }));
}

export async function nextContestSurfaceAction(context: ContestSurfaceContext): Promise<ContestSurfaceActionEnvelope | null> {
  if (!contextValid(context)) throw new Error("The contest surface owner context could not be verified.");
  const value = await invoke("contest_surface_action_next", context);
  if (value === null) return null;
  if (!validContestSurfaceActionEnvelope(value) || value.operatingContext !== context.operatingContext ||
      value.sessionID !== context.sessionID || value.workspaceGeneration !== context.workspaceGeneration)
    throw new Error("The queued contest surface action could not be verified.");
  return value;
}

export async function nextContestSurfaceEscape(context: ContestSurfaceContext): Promise<ContestSurfaceActionEnvelope | null> {
  if (!contextValid(context)) throw new Error("The contest surface owner context could not be verified.");
  const value = await invoke("contest_surface_escape_next", context);
  if (value === null) return null;
  if (!validContestSurfaceActionEnvelope(value) || value.operatingContext !== context.operatingContext ||
      value.sessionID !== context.sessionID || value.workspaceGeneration !== context.workspaceGeneration ||
      value.panelID !== "active-qso" || value.action !== "entry_operator_key" || value.params.key !== "Escape")
    throw new Error("The queued contest surface Escape action could not be verified.");
  return value;
}

export async function completeContestSurfaceAction(completion: ContestSurfaceCompletion): Promise<void> {
  if (!contextValid(completion) || !validContestSurfaceUUID(completion.requestID) || !uint(completion.projectionRevision) ||
      !["applied", "rejected"].includes(completion.outcome) || completion.message !== undefined &&
      (typeof completion.message !== "string" || new TextEncoder().encode(completion.message).length > 512))
    throw new Error("The contest surface completion could not be verified.");
  try { await invoke("contest_surface_action_complete", completion); }
  catch {
    // Native completion is an exact idempotent journal write. Retry the same
    // coordinate once so a lost modal-boundary IPC reply cannot strand a
    // successfully handled action as uncertain.
    await invoke("contest_surface_action_complete", completion);
  }
}

export async function publishContestSurface(publication: ContestSurfacePublication): Promise<void> {
  if (!contextValid(publication) || !validContestSurfaceUUID(publication.ownerEpoch) || publication.scope !== "contesting" ||
      !contestSurfacePanelIDs.includes(publication.panelID) || !uint(publication.projectionRevision) ||
      !validContestSurfaceProjection(publication.panelID, publication.projection))
    throw new Error("The contest surface publication could not be verified.");
  await invoke("contest_surface_publish", publication);
}

export async function claimContestSurfaceOwner(claim: ContestSurfaceOwnerClaim): Promise<number> {
  if (!contextValid(claim) || !validContestSurfaceUUID(claim.ownerEpoch))
    throw new Error("The contest surface owner claim could not be verified.");
  const value = await invoke<unknown>("contest_surface_owner_claim", claim), result = record(value) ? value : undefined;
  if (!result || !exact(result, ["ownerEpoch", "projectionRevision"]) || result.ownerEpoch !== claim.ownerEpoch || !uint(result.projectionRevision))
    throw new Error("The contest surface owner claim response could not be verified.");
  return result.projectionRevision as number;
}

export async function readContestSurfaceSnapshot(context: ContestSurfaceContext): Promise<ContestSurfaceSnapshot> {
  if (!contextValid(context)) throw new Error("The contest surface context could not be verified.");
  return surfaceSnapshot(await invoke("contest_surface_snapshot", {
    sessionID: context.sessionID, workspaceGeneration: context.workspaceGeneration,
  }), context);
}

export async function readContestRotorTarget(context: ContestSurfaceContext): Promise<ContestRotorTarget> {
  if (!contextValid(context)) throw new Error("The contest rotor context could not be verified.");
  const value = await invoke<unknown>("contest_rotor_target", {
    sessionID: context.sessionID, workspaceGeneration: context.workspaceGeneration,
  });
  const target = record(value) ? value : undefined;
  const bearing = (item: unknown) => item === null || typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 360;
  if (!target || !exact(target, ["available", "projectionRevision", "callsign", "shortPathBearing", "longPathBearing"]) ||
      typeof target.available !== "boolean" || !uint(target.projectionRevision) ||
      (target.callsign !== null && (typeof target.callsign !== "string" || !target.callsign.trim() || bytes(target.callsign) > 32)) ||
      !bearing(target.shortPathBearing) || !bearing(target.longPathBearing) || target.available !== (target.callsign !== null))
    throw new Error("The contest rotor target could not be verified.");
  return target as ContestRotorTarget;
}

export async function closeContestSurfaceContext(context: ContestSurfaceContext & { ownerEpoch: string }): Promise<void> {
  if (!contextValid(context) || !validContestSurfaceUUID(context.ownerEpoch))
    throw new Error("The contest surface owner context could not be verified.");
  await invoke("contest_surface_context_close", context);
}

export async function openContestSurfaceWindow(context: ContestSurfaceContext, panelID: ContestSurfacePanelID): Promise<void> {
  if (!contextValid(context) || !contestSurfacePanelIDs.includes(panelID))
    throw new Error("The contest window request could not be verified.");
  if (!isTauri()) throw new Error("Contest windows require the native application.");
  await invoke("contest_window_open", { ...context, panelID });
}

export async function toggleContestSurfaceWindow(context: ContestSurfaceContext, panelID: ContestSurfacePanelID): Promise<void> {
  if (!contextValid(context) || !["band-maps", "callsign-intelligence", "logbook", "monitor", "propagation", "station-control"].includes(panelID))
    throw new Error("The contest window toggle request could not be verified.");
  if (!isTauri()) throw new Error("Contest windows require the native application.");
  await invoke("contest_window_toggle", { ...context, panelID });
}

export async function openContestCallHistoryWindow(context: ContestSurfaceContext): Promise<void> {
  if (!contextValid(context)) throw new Error("The Call History window request could not be verified.");
  if (!isTauri()) throw new Error("Call History requires the native application.");
  await invoke("contest_window_open", { ...context, panelID: "call-history" });
}

export async function openContestContactEditorWindow(context: ContestSurfaceContext): Promise<void> {
  if (!contextValid(context)) throw new Error("The Edit Contact window request could not be verified.");
  if (!isTauri()) throw new Error("Edit Contact requires the native application.");
  await invoke("contest_contact_editor_open", { operatingContext: context.operatingContext,
    sessionID: context.sessionID, workspaceGeneration: context.workspaceGeneration });
}

export async function closeContestContactEditorWindow(): Promise<void> {
  if (!isTauri()) throw new Error("Edit Contact requires the native application.");
  await invoke("contest_contact_editor_close");
}

export async function postContestSpot(callsign: string, frequencyHz: number): Promise<void> {
  const call = callsign.trim().toUpperCase();
  if (!/^[A-Z0-9/-]{2,24}$/.test(call) || !Number.isSafeInteger(frequencyHz) || frequencyHz <= 0)
    throw new Error("A valid callsign and contest frequency are required before posting a spot.");
  if (!isTauri()) throw new Error("Posting a contest spot requires the native application.");
  await invoke("contest_post_spot", { callsign: call, frequencyHz });
}

export async function onContestSurfaceWake(refresh: () => void): Promise<UnlistenFn> {
  return listen(contestSurfaceEvent, () => refresh());
}
