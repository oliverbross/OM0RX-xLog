import { invoke } from "@tauri-apps/api/core";
import type { ContestSurfaceActionEnvelope } from "./contestSurfaceProtocol";
export async function resolveContestCWCallsign(action: Extract<ContestSurfaceActionEnvelope, { action: "entry_cw_callsign" }>): Promise<string> {
  const value = await invoke<Record<string, unknown>>("cw_contest_callsign_resolve", { operationId: action.requestID });
  if (!value || value.operationId !== action.requestID || value.operatingContext !== action.operatingContext || value.sessionID !== action.sessionID ||
    value.workspaceGeneration !== action.workspaceGeneration || value.draftID !== action.params.draftID || value.expectedDraftRevision !== action.params.expectedDraftRevision ||
    typeof value.callsign !== "string" || value.callsign.length < 3 || value.callsign.length > 20 || !/^(?=.*[A-Z])(?=.*[0-9])[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(value.callsign))
    throw new Error("CW callsign evidence no longer belongs to this Entry draft.");
  return value.callsign;
}
