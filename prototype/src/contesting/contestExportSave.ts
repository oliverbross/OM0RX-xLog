import { invoke } from "@tauri-apps/api/core";
import type { ContestPreparedExport, ContestExportFormat } from "./types";
import type { ContestRecoveryStorage } from "./sessionOwner";

export type ContestExportSavePrepared = {
  artifactID: string; sessionID: string; workspaceGeneration: string; revision: number;
  byteLength: number; sha256: string; format: ContestExportFormat;
};
export type ContestExportSaveResult =
  | { status: "saved"; artifactID: string; sha256: string; filename: string }
  | { status: "cancelled"; artifactID: string; sha256: string }
  | { status: "failed"; artifactID: string; sha256: string; filename?: string; message: string };
export type ContestExportSaveAdapter = (prepared: ContestExportSavePrepared) => Promise<ContestExportSaveResult>;
export type ContestExportSaveScope = { sessionID: string; workspaceGeneration: string };
export type ContestExportSaveSnapshot =
  | { phase: "idle" }
  | { phase: "saving"; scope: ContestExportSaveScope; prepared: ContestPreparedExport }
  | { phase: "saved"; scope: ContestExportSaveScope; result: Extract<ContestExportSaveResult, { status: "saved" }> }
  | { phase: "cancelled"; scope: ContestExportSaveScope; result: Extract<ContestExportSaveResult, { status: "cancelled" }> }
  | { phase: "failed"; scope: ContestExportSaveScope; prepared: ContestPreparedExport; result: Extract<ContestExportSaveResult, { status: "failed" }> }
  | { phase: "unknown"; scope?: ContestExportSaveScope; prepared?: ContestPreparedExport };

const MARKER = "xlog.contesting.export-save.pending.v1";
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bytes = (value: string) => new TextEncoder().encode(value).length;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const exact = (value: Record<string, unknown>, required: string[], optional: string[] = []) => {
  const keys = Object.keys(value); return required.every(key => key in value) && keys.every(key => required.includes(key) || optional.includes(key));
};
const text = (value: unknown, max: number, empty = false): value is string => typeof value === "string" && bytes(value) <= max && (empty || value.length > 0);
const message = (value: unknown): value is string => text(value, 512) && [...value].every(character => character === "\n" || character.charCodeAt(0) >= 32);
const uint = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const basename = (value: unknown): value is string => text(value, 160) && value !== "." && value !== ".." &&
  !/[\\/]/.test(value) && [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);

export function nativeSavePrepared(prepared: ContestPreparedExport): ContestExportSavePrepared {
  return { artifactID: prepared.artifactID, sessionID: prepared.sessionID,
    workspaceGeneration: prepared.workspaceGeneration, revision: prepared.revision,
    byteLength: prepared.byteLength, sha256: prepared.sha256, format: prepared.format };
}

export function validateContestExportSaveResult(value: unknown, expected: ContestExportSavePrepared): ContestExportSaveResult {
  const result = object(value);
  if (!result || !text(result.status, 16) || !UUID.test(String(result.artifactID)) || result.artifactID !== expected.artifactID ||
      !SHA256.test(String(result.sha256)) || result.sha256 !== expected.sha256) throw new Error("Native export save returned a malformed or mismatched result.");
  if (result.status === "saved" && exact(result, ["status", "artifactID", "sha256", "filename"]) && basename(result.filename)) return result as ContestExportSaveResult;
  if (result.status === "cancelled" && exact(result, ["status", "artifactID", "sha256"])) return result as ContestExportSaveResult;
  if (result.status === "failed" && exact(result, ["status", "artifactID", "sha256", "message"], ["filename"]) && message(result.message) &&
      (result.filename === undefined || basename(result.filename))) return result as ContestExportSaveResult;
  throw new Error("Native export save returned a malformed or mismatched result.");
}

export const nativeContestExportSave: ContestExportSaveAdapter = async prepared =>
  validateContestExportSaveResult(await invoke("contest_export_save", { prepared }), prepared);

type Release = (prepared: ContestPreparedExport) => Promise<unknown>;
const scopeOf = (prepared: Pick<ContestPreparedExport, "sessionID" | "workspaceGeneration">): ContestExportSaveScope =>
  ({ sessionID: prepared.sessionID, workspaceGeneration: prepared.workspaceGeneration });
export class ContestExportSaveOwner {
  private state: ContestExportSaveSnapshot;
  private listeners = new Set<() => void>();
  private release: Release | null = null;
  constructor(private readonly adapter: ContestExportSaveAdapter, private readonly storage?: ContestRecoveryStorage) {
    const scope = this.pendingMarkerScope();
    this.state = scope !== false ? { phase: "unknown", ...(scope ? { scope } : {}) } : { phase: "idle" };
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private publish(state: ContestExportSaveSnapshot) { this.state = state; for (const listener of this.listeners) listener(); }
  private pendingMarkerScope(): ContestExportSaveScope | null | false {
    try {
      const raw = this.storage?.getItem(MARKER); if (!raw) return false;
      const marker = object(JSON.parse(raw));
      if (marker && text(marker.sessionID, 128) && text(marker.workspaceGeneration, 128))
        return { sessionID: marker.sessionID, workspaceGeneration: marker.workspaceGeneration };
      return null;
    } catch { return null; }
  }
  private mark(prepared: ContestExportSavePrepared) {
    const marker = JSON.stringify({ version: 1, artifactID: prepared.artifactID, sessionID: prepared.sessionID,
      workspaceGeneration: prepared.workspaceGeneration, revision: prepared.revision, sha256: prepared.sha256, format: prepared.format });
    if (!this.storage) throw new Error("Export save recovery storage is unavailable.");
    this.storage.setItem(MARKER, marker);
  }
  private unmark() { try { this.storage?.removeItem(MARKER); } catch { /* known result remains authoritative */ } }
  async save(prepared: ContestPreparedExport, release: Release) {
    if (this.state.phase !== "idle") return;
    await this.performSave(prepared, release);
  }
  private async performSave(prepared: ContestPreparedExport, release: Release) {
    const payload = nativeSavePrepared(prepared);
    const scope = scopeOf(prepared);
    this.release = release;
    try { this.mark(payload); }
    catch {
      this.publish({ phase: "failed", scope, prepared, result: { status: "failed", artifactID: prepared.artifactID,
        sha256: prepared.sha256, message: "Save could not start because recovery state was unavailable." } });
      return;
    }
    this.publish({ phase: "saving", scope, prepared });
    try {
      const result = await this.adapter(payload);
      this.unmark();
      if (result.status === "saved" || result.status === "cancelled") {
        if (result.status === "saved") this.publish({ phase: "saved", scope, result });
        else this.publish({ phase: "cancelled", scope, result });
        void release(prepared).catch(() => {}); this.release = null;
      } else this.publish({ phase: "failed", scope, prepared, result });
    } catch {
      this.publish({ phase: "unknown", scope, prepared });
    }
  }
  async retry(scope: ContestExportSaveScope) {
    if (this.state.phase !== "failed" || !this.release || this.state.scope.sessionID !== scope.sessionID ||
        this.state.scope.workspaceGeneration !== scope.workspaceGeneration) return;
    await this.performSave(this.state.prepared, this.release);
  }
  acknowledgeKnown() { if (this.state.phase === "saved" || this.state.phase === "cancelled") this.publish({ phase: "idle" }); }
  discardKnown() {
    if (this.state.phase === "saved" || this.state.phase === "cancelled") { this.publish({ phase: "idle" }); return; }
    if (this.state.phase !== "failed") return;
    const prepared = this.state.prepared, release = this.release;
    this.release = null; this.publish({ phase: "idle" });
    if (release) void release(prepared).catch(() => {});
  }
  acknowledgeUnknown() {
    if (this.state.phase !== "unknown") return;
    const prepared = this.state.prepared, release = this.release;
    this.unmark(); this.release = null; this.publish({ phase: "idle" });
    if (prepared && release) void release(prepared).catch(() => {});
  }
}

let shared = new WeakMap<ContestExportSaveAdapter, WeakMap<object, ContestExportSaveOwner>>();
const absentStorage = {};
export function sharedContestExportSaveOwner(adapter: ContestExportSaveAdapter, storage?: ContestRecoveryStorage) {
  let byStorage = shared.get(adapter); if (!byStorage) { byStorage = new WeakMap(); shared.set(adapter, byStorage); }
  const key = storage ?? absentStorage; let owner = byStorage.get(key);
  if (!owner) { owner = new ContestExportSaveOwner(adapter, storage); byStorage.set(key, owner); }
  return owner;
}
export function resetContestExportSaveOwnersForTests() { shared = new WeakMap(); }
