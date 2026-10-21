import { invoke, isTauri } from "@tauri-apps/api/core";

export type LegacyContestPreview = {
  contestNR: number;
  contestName: string;
  rowCount: number;
  firstUTC: string | null;
  lastUTC: string | null;
  frequencyHz: number | null;
  exchangeValues: string[];
  settings: Record<string, unknown>;
  pluginCandidates: string[];
};
export type LegacyPreview = {
  source: { identity: string; digest: string; byteLength: number };
  contests: LegacyContestPreview[];
  station: Record<string, unknown> | null;
  contest?: LegacyContestPreview;
};
export type TransferContext = {
  workspaceGeneration: string;
  stationCall?: string;
  sessionID?: string;
  expectedRevision?: number;
  contestName?: string;
  qsoCount?: number;
};
export type TransferResult = {
  phase: "prepared" | "committed" | "status";
  manifest: { manifestID: string; contestSessionID: string; workspaceGeneration: string; sourceRevision: number; sourceDigest: string; provenance: string; qsoCount: number };
  inserted: unknown[];
  alreadyTransferred: unknown[];
  conflicts: Array<{ qsoID: string; code: string; message: string }>;
  errors: Array<{ qsoID: string; code: string; message: string }>;
  counts: { total: number; inserted: number; alreadyTransferred: number; conflicts: number; errors: number; pending: number };
};

export type ContestLogTransferAPI = {
  context: () => Promise<TransferContext | null>;
  chooseLegacy: () => Promise<LegacyPreview | null>;
  importLegacy: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  transfer: (method: "contest_log_transfer_prepare" | "contest_log_transfer_commit" | "contest_log_transfer_status", params: Record<string, unknown>) => Promise<TransferResult>;
};

const desktopOnly = () => {
  if (!isTauri()) throw new Error("Import and transfer require the OM0RX-xLog desktop app.");
};

export const contestLogTransferAPI: ContestLogTransferAPI = {
  async context() { desktopOnly(); return invoke("contest_log_transfer_context"); },
  async chooseLegacy() { desktopOnly(); return invoke("contest_legacy_choose_preview"); },
  async importLegacy(params) { desktopOnly(); return invoke("contest_legacy_import", { params }); },
  async transfer(method, params) { desktopOnly(); return invoke("contest_log_transfer_request", { method, params }); },
};

