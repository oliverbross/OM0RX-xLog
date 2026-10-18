export const contestSurfacePanelIDs = ["active-qso", "band-maps", "callsign-intelligence", "monitor", "propagation",
  "alerts", "awards", "chaser-dx", "rotor", "station-control", "logbook", "dx-cluster"] as const;
export type ContestSurfacePanelID = typeof contestSurfacePanelIDs[number];

type Revision = number;
type DraftRevision = { draftID: string; expectedDraftRevision: Revision };
export type ContestSurfaceAction =
  | { action: "entry_set_text"; params: DraftRevision & { field: "callsign" | "sentReport" | "receivedReport"; value: string } }
  | { action: "entry_set_exchange"; params: DraftRevision & { fieldID: string; value: string } }
  | { action: "entry_set_frequency"; params: DraftRevision & { value: number } }
  | { action: "entry_set_band" | "entry_set_mode"; params: DraftRevision & { value: string } }
  | { action: "entry_reserve_serial" | "entry_commit"; params: DraftRevision }
  | { action: "entry_operator_key"; params: DraftRevision & { key: "F1" | "F2" | "F3" | "F4" | "F5" | "F6" |
      "F7" | "F8" | "F9" | "F10" | "F11" | "F12" | "Enter" | "Escape" } }
  | { action: "assistance_query"; params: DraftRevision & { inputCallsign: string } }
  | { action: "assistance_select"; params: DraftRevision & { kind: "scp" | "history"; candidateID: string } }
  | { action: "log_page"; params: { offset: number } }
  | { action: "log_edit_begin" | "log_edit_cancel"; params: { qsoID: string } }
  | { action: "log_edit_set_text"; params: { qsoID: string; field: "callsign" | "sentReport" | "receivedReport" |
      "correctionReason" | "deletionReason"; value: string } }
  | { action: "log_edit_set_exchange"; params: { qsoID: string; fieldID: string; value: string } }
  | { action: "log_edit_set_frequency"; params: { qsoID: string; value: number } }
  | { action: "log_edit_set_band"; params: { qsoID: string; value: string } }
  | { action: "log_edit_save" | "log_edit_delete"; params: { qsoID: string; expectedSessionRevision: Revision } };

export type ContestSurfaceActionEnvelope = ContestSurfaceAction & {
  operatingContext: string;
  scope: "contesting";
  sessionID: string;
  workspaceGeneration: string;
  panelID: ContestSurfacePanelID;
  projectionRevision: Revision;
  requestID: string;
};

const uuid = (value: unknown) => typeof value === "string" &&
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const bytes = (value: string) => new TextEncoder().encode(value).length;
const text = (value: unknown, maximum: number, allowEmpty = false) => typeof value === "string" &&
  (allowEmpty || value.trim().length > 0) && bytes(value) <= maximum;
const uint = (value: unknown, maximum = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) &&
  (value as number) >= 0 && (value as number) <= maximum;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  typeof value === "string" && choices.includes(value as T);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => {
  const actual = Object.keys(value); return actual.length === keys.length && keys.every(key => actual.includes(key));
};
const draft = (value: Record<string, unknown>, extras: string[]) => exact(value, ["draftID", "expectedDraftRevision", ...extras]) &&
  text(value.draftID, 160) && uint(value.expectedDraftRevision);
const qso = (value: Record<string, unknown>, extras: string[]) => exact(value, ["qsoID", ...extras]) && text(value.qsoID, 160);

function validParams(action: string, params: Record<string, unknown>) {
  if (action === "entry_set_text") return draft(params, ["field", "value"]) &&
    oneOf(params.field, ["callsign", "sentReport", "receivedReport"]) && text(params.value, 160, true);
  if (action === "entry_set_exchange") return draft(params, ["fieldID", "value"]) && text(params.fieldID, 64) && text(params.value, 1024, true);
  if (action === "entry_set_frequency") return draft(params, ["value"]) && uint(params.value, 100_000_000_000);
  if (action === "entry_set_band" || action === "entry_set_mode") return draft(params, ["value"]) && text(params.value, 16);
  if (action === "entry_reserve_serial" || action === "entry_commit") return draft(params, []);
  if (action === "entry_operator_key") return draft(params, ["key"]) &&
    typeof params.key === "string" && /^(?:F(?:[1-9]|1[0-2])|Enter|Escape)$/.test(params.key);
  if (action === "assistance_query") return draft(params, ["inputCallsign"]) && text(params.inputCallsign, 32, true);
  if (action === "assistance_select") return draft(params, ["kind", "candidateID"]) &&
    oneOf(params.kind, ["scp", "history"]) && text(params.candidateID, 160);
  if (action === "log_page") return exact(params, ["offset"]) && uint(params.offset, 1_000_000);
  if (action === "log_edit_begin" || action === "log_edit_cancel") return qso(params, []);
  if (action === "log_edit_set_text") return qso(params, ["field", "value"]) &&
    oneOf(params.field, ["callsign", "sentReport", "receivedReport", "correctionReason", "deletionReason"]) && text(params.value, 1024, true);
  if (action === "log_edit_set_exchange") return qso(params, ["fieldID", "value"]) && text(params.fieldID, 64) && text(params.value, 1024, true);
  if (action === "log_edit_set_frequency") return qso(params, ["value"]) && uint(params.value, 100_000_000_000);
  if (action === "log_edit_set_band") return qso(params, ["value"]) && text(params.value, 16);
  if (action === "log_edit_save" || action === "log_edit_delete") return qso(params, ["expectedSessionRevision"]) && uint(params.expectedSessionRevision);
  return false;
}

export function validateContestSurfaceActionEnvelope(value: unknown): asserts value is ContestSurfaceActionEnvelope {
  const envelope = record(value) ? value : undefined;
  const keys = ["operatingContext", "scope", "sessionID", "workspaceGeneration", "panelID", "projectionRevision", "requestID", "action", "params"];
  const action = typeof envelope?.action === "string" ? envelope.action : "";
  const panel = typeof envelope?.panelID === "string" ? envelope.panelID : "";
  const params = record(envelope?.params) ? envelope.params : undefined;
  const panelMatches = action.startsWith("entry_") ? panel === "active-qso" : action.startsWith("assistance_")
    ? panel === "callsign-intelligence" : action.startsWith("log_") ? panel === "logbook" : false;
  if (!envelope || !exact(envelope, keys) || !uuid(envelope.operatingContext) || envelope.scope !== "contesting" ||
      !uuid(envelope.sessionID) || !uuid(envelope.workspaceGeneration) || !oneOf(panel, contestSurfacePanelIDs) ||
      !uint(envelope.projectionRevision) || !uuid(envelope.requestID) || !params || !panelMatches || !validParams(action, params))
    throw new Error("The contest surface action envelope could not be verified.");
}
