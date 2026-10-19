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
  projectionRevision: number; projection: unknown };

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
  const panelID = single("view"), context = { operatingContext: single("operatingContext"), sessionID: single("sessionID"),
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
  return actionReceipt(await invoke("contest_surface_action", action));
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
  await invoke("contest_surface_action_complete", completion);
}

export async function publishContestSurface(publication: ContestSurfacePublication): Promise<void> {
  if (!contextValid(publication) || publication.scope !== "contesting" ||
      !contestSurfacePanelIDs.includes(publication.panelID) || !uint(publication.projectionRevision) ||
      !validContestSurfaceProjection(publication.panelID, publication.projection))
    throw new Error("The contest surface publication could not be verified.");
  await invoke("contest_surface_publish", publication);
}

export async function readContestSurfaceSnapshot(context: ContestSurfaceContext): Promise<ContestSurfaceSnapshot> {
  if (!contextValid(context)) throw new Error("The contest surface context could not be verified.");
  return surfaceSnapshot(await invoke("contest_surface_snapshot", {
    sessionID: context.sessionID, workspaceGeneration: context.workspaceGeneration,
  }), context);
}

export async function closeContestSurfaceContext(context: ContestSurfaceContext): Promise<void> {
  if (!contextValid(context)) throw new Error("The contest surface owner context could not be verified.");
  await invoke("contest_surface_context_close", context);
}

export async function openContestSurfaceWindow(context: ContestSurfaceContext, panelID: ContestSurfacePanelID): Promise<void> {
  if (!contextValid(context) || !contestSurfacePanelIDs.includes(panelID))
    throw new Error("The contest window request could not be verified.");
  if (!isTauri()) throw new Error("Contest windows require the native application.");
  await invoke("contest_window_open", { ...context, panelID });
}

export async function onContestSurfaceWake(refresh: () => void): Promise<UnlistenFn> {
  return listen(contestSurfaceEvent, () => refresh());
}
