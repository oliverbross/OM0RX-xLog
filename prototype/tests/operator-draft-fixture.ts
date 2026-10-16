/** In-memory implementation of the draft protocol for rendered workflow tests. */
import type { WorkspacePreferences } from "../src/live/workspacePreferences";

export const testWorkspaceGeneration = "00000000-0000-4000-8000-000000000001";
export const testWorkspacePreferences = (overrides: Partial<WorkspacePreferences> = {}): WorkspacePreferences => ({
  deskBandMapBands: ["20m", "15m"], detachedBandMapBands: ["20m", "15m"],
  deskBandMapFollowsRadio: false, detachedBandMapFollowsRadio: false,
  detachedBandMapLayout: "Adaptive grid", bandMapFontScale: 1,
  intelligenceBands: ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m"],
  clusterSpotOpensFullEditor: false, savedLogbookFilters: [], ...overrides,
});
export const testPreferenceSnapshot = (overrides: Partial<WorkspacePreferences> = {}) => ({
  stored: true, preferences: testWorkspacePreferences(overrides), generation: testWorkspaceGeneration, revision: 0,
});
export function operatorDraftFixture(qso: Record<string, any>) {
  let draft = { revision: 0, qso: structuredClone(qso), generation: testWorkspaceGeneration };
  const receipts = new Map<string, any>();
  return (method: string, params: any = {}) => {
    if (method === "logbook_operator_draft") return { draft: structuredClone(draft) };
    if (method === "logbook_operator_draft_receipt") return { receipt: structuredClone(receipts.get(params.operationID) ?? null) };
    if (method !== "logbook_operator_draft_apply") return undefined;
    if (receipts.has(params.operationID)) return { status: "applied", receipt: structuredClone(receipts.get(params.operationID)) };
    if (params.draftID !== draft.qso.id || params.expectedRevision !== draft.revision)
      return { status: "conflict", draft: structuredClone(draft) };
    const savedQSO = params.action === "save" ? structuredClone(draft.qso) : null;
    draft = { generation: testWorkspaceGeneration, revision: draft.revision + 1, qso: params.action === "replace" ? structuredClone(params.qso) :
      { ...qso, id: `draft-${draft.revision + 2}`, call: "" } };
    const receipt = { mutation: structuredClone(params), draft: structuredClone(draft), savedQSO };
    receipts.set(params.operationID, receipt);
    return { status: "applied", receipt: structuredClone(receipt) };
  };
}
