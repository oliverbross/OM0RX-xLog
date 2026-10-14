export type SettingsValues = Record<string, any>;
export type SettingsSnapshot = { revision: number; generation: string; settings: SettingsValues };
export type SettingsMutation = { operationID: string; expectedRevision: number; generation: string; settings: SettingsValues };
export type SettingsJournal = { version: 1; base: SettingsSnapshot; draft: SettingsValues; pending: SettingsMutation | null };
export type SettingsState = {
  snapshot: SettingsSnapshot | null;
  base: SettingsSnapshot | null;
  draft: SettingsValues | null;
  pending: SettingsMutation | null;
  conflict: SettingsSnapshot | null;
  saving: boolean;
  error: string;
  workspaceChanged: boolean;
};
type Request = (method: "settings_load" | "settings_save" | "settings_receipt", params?: Record<string, unknown>) => Promise<any>;

const object = (value: any): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: any) => Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const uuid = (value: any): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const clone = <T>(value: T): T => structuredClone(value);
const sameGeneration = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const stable = (value: any): string => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const storedSettings = (settings: SettingsValues) => ({ ...clone(settings), automaticSync: false });
const secretKey = /(token|password|api.?key|secret|credential)/i;
const hasSecretKey = (value: any): boolean => Array.isArray(value) ? value.some(hasSecretKey)
  : object(value) && Object.entries(value).some(([key, item]) => secretKey.test(key) || hasSecretKey(item));
const withoutSecrets = (value: any): any => Array.isArray(value) ? value.map(withoutSecrets)
  : object(value) ? Object.fromEntries(Object.entries(value).filter(([key]) => !secretKey.test(key))
    .map(([key, item]) => [key, withoutSecrets(item)])) : clone(value);
const nonSecret = (settings: SettingsValues) => withoutSecrets(settings) as SettingsValues;

export function settingsDraftIsDirty(base: SettingsSnapshot | null, draft: SettingsValues | null) {
  return !!base && !!draft && stable(storedSettings(draft)) !== stable(storedSettings(base.settings));
}

export function checkedSettingsSnapshot(value: any): SettingsSnapshot {
  if (!object(value) || !uuid(value.generation) || !integer(value.revision) || !object(value.settings) ||
      JSON.stringify(value.settings).length > 65_536) throw new Error("The shared Settings snapshot could not be verified.");
  return { revision: value.revision, generation: value.generation.toLowerCase(), settings: clone(value.settings) };
}

function validMutation(value: any): value is SettingsMutation {
  return object(value) && uuid(value.operationID) && uuid(value.generation) && integer(value.expectedRevision) &&
    object(value.settings) && JSON.stringify(value.settings).length <= 65_536;
}

// Foundation UUID Codable emits uppercase; JS UUIDs and loaded generations use
// lowercase. Only validated UUID spellings are normalized. Payload text,
// revision and all remaining keys (including unexpected keys) stay exact.
const mutationFingerprint = (value: SettingsMutation) => stable({ ...value,
  operationID: value.operationID.toLowerCase(), generation: value.generation.toLowerCase() });

function checkedReceiptSnapshot(receipt: any, mutation: SettingsMutation, base: SettingsSnapshot) {
  if (!object(receipt) || !validMutation(receipt.mutation) || !validMutation(mutation) ||
      mutationFingerprint(receipt.mutation) !== mutationFingerprint(mutation))
    throw new Error("The Settings receipt did not match the pending save.");
  const committed = checkedSettingsSnapshot(receipt.snapshot);
  const expectedRevision = stable(storedSettings(base.settings)) === stable(mutation.settings)
    ? mutation.expectedRevision : mutation.expectedRevision + 1;
  if (!sameGeneration(committed.generation, mutation.generation) || committed.revision !== expectedRevision ||
      stable(committed.settings) !== stable(mutation.settings))
    throw new Error("The Settings receipt did not match the requested values.");
  return committed;
}

export function readSettingsJournal(raw: string | null): SettingsJournal | null {
  if (!raw || raw.length > 150_000) return null;
  try {
    const value = JSON.parse(raw), base = checkedSettingsSnapshot(value.base);
    if (value.version !== 1 || !object(value.draft) || hasSecretKey(value.draft) ||
        JSON.stringify(value.draft).length > 65_536 ||
        value.pending !== null && !validMutation(value.pending)) return null;
    if (value.pending && (!sameGeneration(value.pending.generation, base.generation) || value.pending.expectedRevision !== base.revision)) return null;
    return { version: 1, base, draft: clone(value.draft), pending: value.pending ? clone(value.pending) : null };
  } catch { return null; }
}

const empty = (): SettingsState => ({ snapshot: null, base: null, draft: null, pending: null, conflict: null,
  saving: false, error: "", workspaceChanged: false });

/** Parent-owned non-secret Settings editor. It journals raw form values before
 * sending a mutation and never replays an unknown write without operator action. */
export class SettingsSession {
  private state: SettingsState = empty();
  private listeners = new Set<() => void>();
  private action: Promise<void> | null = null;
  constructor(private request: Request, private writeJournal: (value: SettingsJournal | null) => void = () => {},
              pending: SettingsJournal | null = null, private newID = () => crypto.randomUUID()) {
    if (pending) this.state = { ...empty(), base: clone(pending.base), draft: clone(pending.draft), pending: clone(pending.pending) };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<SettingsState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener()); }
  private journal(pending = this.state.pending) {
    if (!this.state.base || !this.state.draft) return;
    this.writeJournal({ version: 1, base: clone(this.state.base), draft: clone(this.state.draft), pending: pending ? clone(pending) : null });
  }
  private accept(snapshot: SettingsSnapshot) {
    this.writeJournal(null);
    this.update({ snapshot, base: clone(snapshot), draft: clone(snapshot.settings), pending: null, conflict: null,
      saving: false, error: "", workspaceChanged: false });
  }
  async load() {
    const snapshot = checkedSettingsSnapshot(await this.request("settings_load"));
    const base = this.state.base, draft = this.state.draft, pending = this.state.pending;
    if (!base || !draft) { this.accept(snapshot); return; }
    this.update({ snapshot });
    const dirty = settingsDraftIsDirty(base, draft);
    if (!sameGeneration(base.generation, snapshot.generation)) {
      if (!pending && !dirty) { this.accept(snapshot); return; }
      this.update({ conflict: snapshot, workspaceChanged: true,
        error: "The workspace was restored or replaced. Your unsaved Settings text is retained for review." });
      return;
    }
    if (pending) {
      await this.reconcile();
      return;
    }
    if (snapshot.revision !== base.revision || stable(storedSettings(snapshot.settings)) !== stable(storedSettings(base.settings))) {
      if (!dirty) { this.accept(snapshot); return; }
      this.update({ conflict: snapshot, error: "Settings changed in another window. Your unsaved text is retained." });
      return;
    }
    this.update({ conflict: null, error: "", workspaceChanged: false });
  }
  edit(values: SettingsValues) {
    if (!this.state.base || this.state.saving || this.state.pending || this.state.conflict || this.state.workspaceChanged)
      throw new Error("Resolve the current Settings change before editing.");
    this.update({ draft: clone(nonSecret(values)), error: "" });
    this.journal(null);
  }
  async save(settings: SettingsValues) {
    if (this.action) return this.action;
    const base = this.state.base;
    if (!base || !this.state.draft || this.state.pending || this.state.conflict || this.state.workspaceChanged)
      throw new Error("Resolve the current Settings change before saving.");
    const mutation: SettingsMutation = { operationID: this.newID(), expectedRevision: base.revision,
      generation: base.generation, settings: storedSettings(nonSecret(settings)) };
    this.update({ pending: mutation }); this.journal(mutation);
    return this.send(mutation);
  }
  private send(mutation: SettingsMutation) {
    this.update({ saving: true, error: "" });
    this.action = (async () => {
      try {
        const response = await this.request("settings_save", mutation);
        if (response?.status === "workspace_changed") {
          this.update({ workspaceChanged: true, error: "The workspace was restored or replaced. Your Settings text is retained." });
          return;
        }
        if (response?.status === "conflict") {
          const conflict = checkedSettingsSnapshot(response);
          this.update({ pending: null, conflict, error: "Settings changed in another window. Your unsaved text is retained." });
          this.journal(null);
          return;
        }
        if (response?.status !== "applied") throw new Error("The Settings acknowledgement could not be verified.");
        const committed = checkedReceiptSnapshot(response.receipt, mutation, this.state.base!);
        const acknowledged = checkedSettingsSnapshot(response);
        if (stable(acknowledged) !== stable(committed))
          throw new Error("The Settings acknowledgement did not match its receipt.");
        this.accept(acknowledged);
      } catch (cause) {
        this.update({ error: cause instanceof Error ? cause.message : "The Settings outcome is unknown. Check it before retrying." });
        throw cause;
      } finally { this.action = null; this.update({ saving: false }); }
    })();
    return this.action;
  }
  retry() {
    if (this.action) return this.action;
    if (!this.state.pending || this.state.workspaceChanged) return Promise.reject(new Error("No Settings save is available to retry."));
    return this.send(this.state.pending);
  }
  async reconcile() {
    if (this.action) return this.action;
    const pending = this.state.pending;
    if (!pending || this.state.workspaceChanged) return;
    this.update({ saving: true });
    this.action = (async () => {
      try {
        const response = await this.request("settings_receipt", { operationID: pending.operationID, generation: pending.generation });
        if (response?.status === "workspace_changed") {
          this.update({ workspaceChanged: true, error: "The workspace was restored or replaced. Your Settings text is retained." });
        } else if (response?.receipt) {
          checkedReceiptSnapshot(response.receipt, pending, this.state.base!);
          const loaded = checkedSettingsSnapshot(await this.request("settings_load"));
          if (!sameGeneration(loaded.generation, pending.generation)) {
            this.update({ snapshot: loaded, conflict: loaded, workspaceChanged: true,
              error: "The workspace was restored or replaced. Your Settings text is retained." });
            return;
          }
          this.accept(loaded);
        } else if (response?.receipt === null) {
          this.update({ error: "No Settings receipt is available. Retry reuses the same operation ID; use saved values only if you want to discard this edit." });
        } else throw new Error("The Settings receipt response could not be verified.");
      } catch (cause) {
        this.update({ error: cause instanceof Error ? cause.message : "The Settings receipt could not be verified." });
        throw cause;
      } finally { this.action = null; this.update({ saving: false }); }
    })();
    return this.action;
  }
  useSaved() {
    if (this.state.saving || !this.state.snapshot) throw new Error("Wait for the Settings check to finish.");
    this.accept(this.state.snapshot);
  }
  clear() { this.writeJournal(null); this.update(empty()); }
}
