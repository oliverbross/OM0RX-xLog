export type ContestMethod =
  | "contest_catalog" | "contest_sessions" | "contest_create" | "contest_open"
  | "contest_draft_get" | "contest_draft_apply" | "contest_serial_reserve"
  | "contest_qso_commit" | "contest_qso_get" | "contest_qso_correct" | "contest_qso_delete"
  | "contest_operation_receipt" | "contest_log_page" | "contest_score"
  | "contest_export_prepare" | "contest_export_read" | "contest_export_release";

export type ContestWorkerError = { code?: string; message?: string; outcome?: "confirmed" | "uncertain" };
export type ContestWorkerResponse<T> = { id: string; ok: true; result: T } | { id: string; ok: false; error: ContestWorkerError };
export type ContestRequest = <T = unknown>(method: ContestMethod, params?: Record<string, unknown>) => Promise<ContestWorkerResponse<T>>;
export type SourceVerificationStatus = "verified" | "provisional" | "unverified";

export type ContestMode = "CW" | "SSB";
export type ContestRuleID = "cq-ww-cw" | "cq-wpx-cw" | "cq-ww-ssb" | "cq-wpx-ssb" | "oceania-dx-cw" | "oceania-dx-ssb" | "sac-cw" | "sac-ssb";
export type ContestRuleIdentity = { id: ContestRuleID; version: string; edition: string; sourceRevision: string };
export type ContestEntryDescriptor = {
  mode: ContestMode; adifMode: ContestMode; cabrilloQSOType: "CW" | "PH";
  cabrilloFormatterVersion: "pilot-1" | "ssb-pilot-1";
  cabrilloProjectionFormatterVersion: "pilot-2" | "ssb-pilot-2";
  report: { format: "cwRST" | "phoneRS"; defaultSent: string; defaultReceived: string; maximumUTF8Bytes: 2 | 3 };
  exchange: { sent: "cqZone" | "serialNumber"; received: "cqZone" | "serialNumber"; sentDefault: "stationSnapshot" | "reservedSerial"; adifFields: "none" | "stxSrx" | "exchangeStrings" };
  serial: { requirement: "none" | "requiredForCommit"; allowedScopes: ("session" | "band" | "transmitter")[] };
};
export type ContestRuleMetadata = {
  identity: ContestRuleIdentity; displayName: "CQ WW CW" | "CQ WPX CW" | "CQ WW SSB" | "CQ WPX SSB" | "Oceania DX CW" | "Oceania DX SSB" | "Scandinavian Activity Contest CW" | "Scandinavian Activity Contest SSB"; mode: ContestMode;
  entryDescriptorVersion: 1;
  entry: ContestEntryDescriptor;
  referenceDataVersion: string; sourceVerification: SourceVerificationStatus; sourceNote: string;
};
export type ContestStationSnapshot = { callsign: string; cqZone: string; dxccEntity: string };
export type ContestOperatorSnapshot = { callsign: string; category: string };
export type ContestSessionSummary = {
  sessionID: string; workspaceGeneration: string; revision: number; name: string; rule: ContestRuleMetadata;
  referenceDataVersion: string; station: ContestStationSnapshot; operator: ContestOperatorSnapshot;
  qsoCount: number; updatedAt: string;
};
export type ContestDraftFields = {
  callsign: string; sentReport: string; sentExchange: string; receivedReport: string; receivedExchange: string;
  frequencyHz: number | null; band: string; mode: ContestMode;
};
export type ContestDraftSnapshot = {
  draftID: string; sessionID: string; workspaceGeneration: string; revision: number; fields: ContestDraftFields;
  reservedSerial: number | null; validation: { errors: string[]; warnings: string[] };
  dupe: { state: "clear" | "duplicate" | "unchecked"; reason: string }; updatedAt: string;
};
export type ContestQSO = {
  qsoID: string; sessionID: string; workedAt: string; callsign: string; band: string; mode: ContestMode;
  sentExchange: string; receivedExchange: string; points: number; multiplier: string | null; isDupe: boolean;
};
export type ContestEntity = { adif: number; name: string; countryPrefix: string; continent: string; cqZone: number };
export type ContestQSOProvenance = {
  source: "operatorEntry" | "importFile" | "digitalReceiver" | "networkPeer";
  sourceIdentity: string | null; importedClaimedScore: number | null;
};
export type ContestFullQSO = {
  qsoID: string; sessionID: string; originalUTC: string; callsign: string; band: string; mode: ContestMode;
  frequencyHz: number; sentReport: string; receivedReport: string;
  sentExchange: string; normalizedSentExchange: string; allocatedSerial: string;
  receivedExchange: string; normalizedReceivedExchange: string; entity: ContestEntity | null;
  operatorCallsign: string; stationLocation: string; provenance: ContestQSOProvenance;
  ruleIdentity: ContestRuleIdentity; referenceDataVersion: string;
};
export type ContestQSOReadResult = {
  sessionID: string; workspaceGeneration: string; revision: number; qso: ContestFullQSO;
};
export type ContestQSOCorrection = Omit<ContestFullQSO, "entity">;
export type ContestScore = {
  sessionID: string; workspaceGeneration: string; revision: number; qsos: number; points: number;
  multipliers: number; claimedScore: number; multiplierLabels: string[]; sourceVerification: SourceVerificationStatus;
};
export type ContestScoreSummary = Omit<ContestScore, "multiplierLabels">;
export type ContestMutationScope = {
  sessionID: string; workspaceGeneration: string; requestID: string; expectedRevision: number;
  draftID?: string; payloadDigest: string; operationTimestamp: string;
};
export type ContestMutationReceipt = { requestID: string; payloadDigest: string; committedRevision: number; committedAt: string };
export type ContestOpenResult = { session: ContestSessionSummary; draft: ContestDraftSnapshot };
export type ContestDraftResult = ContestOpenResult & { receipt: ContestMutationReceipt };
export type ContestCommitResult = ContestDraftResult & { qso: ContestQSO; score: ContestScoreSummary };
export type ContestCreateResult = ContestDraftResult;
export type ContestChangeSession = {
  sessionID: string; workspaceGeneration: string; revision: number; name: string;
  ruleIdentity: ContestRuleIdentity; referenceDataVersion: string; qsoCount: number; updatedAt: string;
};
export type ContestAuditReference = { sessionID: string; qsoID: string; requestID: string; revision: number };
export type ContestQSOChangeResult = {
  session: ContestChangeSession; operation: "correction" | "deletion"; qsoID: string; qsoCount: number;
  score: ContestScoreSummary; currentTarget: ContestFullQSO | null;
  auditReference: ContestAuditReference; receipt: ContestMutationReceipt;
};
export type ContestOperationReceiptResult = { status: "committed"; receipt: ContestMutationReceipt } | { status: "not_found" };
export type ContestLogPage = {
  sessionID: string; workspaceGeneration: string; revision: number; qsos: ContestQSO[];
  total: number; offset: number; limit: number;
};
export type ContestCreateInput = {
  name: string; ruleIdentity: ContestRuleIdentity; referenceDataVersion: string;
  station: ContestStationSnapshot; operator: ContestOperatorSnapshot;
};

export type ContestExportFormat = "cabrillo" | "adif";
export type ContestCabrilloHeader = {
  callsign: string; categoryOperator: string; categoryAssisted: string; categoryBand: string;
  categoryMode: string; categoryTransmitter: string; categoryPower: string; categoryOverlay?: string;
  operators: string[]; location: string; club?: string; name: string; addressLines: string[]; email: string;
};
export type ContestExportPrepareRequest = {
  exportID: string; sessionID: string; workspaceGeneration: string; expectedRevision: number;
  generatedAtUTC: string; format: ContestExportFormat; header: ContestCabrilloHeader;
};
export type ContestPreparedExport = {
  artifactID: string; sessionID: string; workspaceGeneration: string; revision: number;
  format: ContestExportFormat; inputSchemaVersion: string; formatterVersion: string; generatedAtUTC: string;
  qsoCount: number; totalPoints: number; multiplierCount: number; claimedScore: number;
  byteLength: number; sha256: string; chunkLimit: number; expiresAfterSeconds: number;
};
export type ContestExportReadRequest = {
  exportID: string; sessionID: string; workspaceGeneration: string; offset: number; length: number;
};
export type ContestExportChunk = {
  artifactID: string; sessionID: string; workspaceGeneration: string; revision: number; offset: number;
  dataBase64: string; eof: boolean; byteLength: number; sha256: string;
};
export type ContestExportReleaseResult = { artifactID: string; released: boolean };
