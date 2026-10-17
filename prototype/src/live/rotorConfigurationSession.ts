export type RotorOwnerPreference = "native_dcu1" | "hamlib";
export type RotorConfiguration = {
  owner: RotorOwnerPreference;
  native_dcu1: { host: string; port: number; name: string };
  hamlib: { mode: "managed" | "external"; model?: number; path: string; baud: number;
    host: string; port: number; serial: Record<string, string | number> };
  auto_rotor_at_startup: boolean;
  auto_rotor_bands: string[];
};
export type RotorConfigurationSnapshot = { revision: number; generation: string; configuration: RotorConfiguration };
export type RotorConfigurationMutation = { operationID: string; expectedRevision: number; generation: string; configuration: RotorConfiguration };
export type RotorConfigurationJournal = { version: 1; base: RotorConfigurationSnapshot; draft: RotorConfiguration; pending: RotorConfigurationMutation | null };
export type RotorConfigurationState = {
  snapshot: RotorConfigurationSnapshot | null; base: RotorConfigurationSnapshot | null; draft: RotorConfiguration | null;
  pending: RotorConfigurationMutation | null; conflict: RotorConfigurationSnapshot | null;
  saving: boolean; error: string; workspaceChanged: boolean;
};
type Request = (method: "workspace_rotor_configuration_load" | "workspace_rotor_configuration_save" |
  "workspace_rotor_configuration_receipt", params?: Record<string, unknown>) => Promise<any>;

const object = (value: any): value is Record<string, any> => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: any) => Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const uuid = (value: any): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const clone = <T>(value: T): T => structuredClone(value);
const stable = (value: any): string => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sameGeneration = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const serialKeys = new Set(["data_bits", "stop_bits", "parity", "handshake", "dtr_state", "rts_state"]);
export const autoRotorBands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "2m", "70cm"] as const;
const autoRotorBandSet = new Set<string>(autoRotorBands);
const migratedAutomaticPolicy = (value: any) => object(value) ? { ...value,
  ...(value.auto_rotor_at_startup === undefined ? { auto_rotor_at_startup: true } : {}),
  ...(value.auto_rotor_bands === undefined ? { auto_rotor_bands: [...autoRotorBands] } : {}),
} : value;

export const defaultRotorConfiguration = (): RotorConfiguration => ({
  owner: "native_dcu1", native_dcu1: { host: "", port: 4001, name: "Rotor" },
  hamlib: { mode: "managed", path: "", baud: 9600, host: "127.0.0.1", port: 4533, serial: {} },
  auto_rotor_at_startup: true, auto_rotor_bands: [...autoRotorBands],
});

export function checkedRotorConfiguration(value: any): RotorConfiguration {
  if (!object(value) || !["native_dcu1", "hamlib"].includes(value.owner) || !object(value.native_dcu1) || !object(value.hamlib) ||
      typeof value.native_dcu1.host !== "string" || typeof value.native_dcu1.name !== "string" ||
      !Number.isInteger(value.native_dcu1.port) || value.native_dcu1.port < 1 || value.native_dcu1.port > 65535 ||
      !["managed", "external"].includes(value.hamlib.mode) || typeof value.hamlib.path !== "string" ||
      typeof value.hamlib.host !== "string" || !Number.isInteger(value.hamlib.baud) || value.hamlib.baud < 300 || value.hamlib.baud > 921600 ||
      !Number.isInteger(value.hamlib.port) || value.hamlib.port < 1 || value.hamlib.port > 65535 || !object(value.hamlib.serial) ||
      typeof value.auto_rotor_at_startup !== "boolean" || !Array.isArray(value.auto_rotor_bands) ||
      value.auto_rotor_bands.length > autoRotorBands.length || new Set(value.auto_rotor_bands).size !== value.auto_rotor_bands.length ||
      value.auto_rotor_bands.some((band: unknown) => typeof band !== "string" || !autoRotorBandSet.has(band)) ||
      value.hamlib.model !== undefined && (!Number.isInteger(value.hamlib.model) || value.hamlib.model < 1) ||
      Object.keys(value.hamlib.serial).some(key => !serialKeys.has(key)) || JSON.stringify(value).length > 16_384)
    throw new Error("The shared rotor configuration could not be verified.");
  return clone(value as RotorConfiguration);
}

export function checkedRotorConfigurationSnapshot(value: any): RotorConfigurationSnapshot {
  if (!object(value) || !uuid(value.generation) || !integer(value.revision))
    throw new Error("The shared rotor configuration snapshot could not be verified.");
  return { revision: value.revision, generation: value.generation.toLowerCase(),
    configuration: checkedRotorConfiguration(value.configuration) };
}

export function rotorConfigurationDirty(base: RotorConfigurationSnapshot | null, draft: RotorConfiguration | null) {
  return !!base && !!draft && stable(base.configuration) !== stable(draft);
}

export function legacyRotorConfiguration(storage: Pick<Storage, "getItem">): RotorConfiguration {
  const value = defaultRotorConfiguration();
  try {
    value.owner = storage.getItem("xlog.integration.rotor") === "hamlib" ? "hamlib" : "native_dcu1";
    value.native_dcu1.host = storage.getItem("xlog.rotor.host") || "";
    const port = Number(storage.getItem("xlog.rotor.port") || 4001);
    value.native_dcu1.port = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 4001;
    value.native_dcu1.name = storage.getItem("xlog.rotor.name")?.trim() || "Rotor";
    const hamlib = JSON.parse(storage.getItem("xlog.hamlib.rotor") || "null");
    if (object(hamlib)) {
      value.hamlib.mode = hamlib.mode === "external" ? "external" : "managed";
      if (Number.isInteger(hamlib.model) && hamlib.model > 0) value.hamlib.model = hamlib.model;
      if (typeof hamlib.path === "string") value.hamlib.path = hamlib.path;
      if (Number.isInteger(hamlib.baud) && hamlib.baud >= 300 && hamlib.baud <= 921600) value.hamlib.baud = hamlib.baud;
      if (typeof hamlib.host === "string") value.hamlib.host = hamlib.host;
      if (Number.isInteger(hamlib.port) && hamlib.port >= 1 && hamlib.port <= 65535) value.hamlib.port = hamlib.port;
      if (object(hamlib.serial)) value.hamlib.serial = Object.fromEntries(Object.entries(hamlib.serial).filter(([key]) => serialKeys.has(key))) as Record<string, string | number>;
    }
  } catch { /* Invalid browser-local values are replaced with bounded defaults. */ }
  return value;
}

export function clearLegacyRotorConfiguration(storage: Pick<Storage, "removeItem">) {
  for (const key of ["xlog.integration.rotor", "xlog.rotor.host", "xlog.rotor.port", "xlog.rotor.name", "xlog.hamlib.rotor"])
    try { storage.removeItem(key); } catch { /* A verified database snapshot remains canonical. */ }
}

function validMutation(value: any): value is RotorConfigurationMutation {
  try { return object(value) && uuid(value.operationID) && uuid(value.generation) && integer(value.expectedRevision) &&
    stable(checkedRotorConfiguration(value.configuration)) === stable(value.configuration); } catch { return false; }
}

// Foundation UUID Codable emits uppercase; JS UUIDs and loaded generations use
// lowercase. Normalize only validated UUID spellings, never the payload text or
// the remaining mutation keys (including unexpected keys).
const mutationFingerprint = (value: RotorConfigurationMutation) => stable({ ...value,
  operationID: value.operationID.toLowerCase(), generation: value.generation.toLowerCase() });

function receiptSnapshot(receipt: any, mutation: RotorConfigurationMutation, base: RotorConfigurationSnapshot) {
  if (!object(receipt) || !validMutation(receipt.mutation) || !validMutation(mutation) ||
      mutationFingerprint(receipt.mutation) !== mutationFingerprint(mutation))
    throw new Error("The rotor configuration receipt did not match the pending save.");
  const committed = checkedRotorConfigurationSnapshot(receipt.snapshot);
  const expected = stable(base.configuration) === stable(mutation.configuration) ? mutation.expectedRevision : mutation.expectedRevision + 1;
  if (!sameGeneration(committed.generation, mutation.generation) || committed.revision !== expected ||
      stable(committed.configuration) !== stable(mutation.configuration))
    throw new Error("The rotor configuration receipt did not match the requested values.");
  return committed;
}

export function readRotorConfigurationJournal(raw: string | null): RotorConfigurationJournal | null {
  if (!raw || raw.length > 60_000) return null;
  try {
    const value = JSON.parse(raw);
    const base = checkedRotorConfigurationSnapshot({ ...value.base,
      configuration: migratedAutomaticPolicy(value.base?.configuration) });
    const draft = checkedRotorConfiguration(migratedAutomaticPolicy(value.draft));
    const pending = value.pending ? { ...value.pending,
      configuration: migratedAutomaticPolicy(value.pending.configuration) } : null;
    if (value.version !== 1 || pending !== null && !validMutation(pending)) return null;
    if (pending && (!sameGeneration(pending.generation, base.generation) || pending.expectedRevision !== base.revision)) return null;
    return { version: 1, base, draft, pending: pending ? clone(pending) : null };
  } catch { return null; }
}

const empty = (): RotorConfigurationState => ({ snapshot: null, base: null, draft: null, pending: null,
  conflict: null, saving: false, error: "", workspaceChanged: false });

export class RotorConfigurationSession {
  private state: RotorConfigurationState = empty();
  private listeners = new Set<() => void>();
  private action: Promise<void> | null = null;
  constructor(private request: Request, private writeJournal: (value: RotorConfigurationJournal | null) => void = () => {},
              pending: RotorConfigurationJournal | null = null, private newID = () => crypto.randomUUID()) {
    if (pending) this.state = { ...empty(), base: clone(pending.base), draft: clone(pending.draft), pending: clone(pending.pending) };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<RotorConfigurationState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener()); }
  private journal(pending = this.state.pending) {
    if (!this.state.base || !this.state.draft) return;
    this.writeJournal({ version: 1, base: clone(this.state.base), draft: clone(this.state.draft), pending: pending ? clone(pending) : null });
  }
  private accept(snapshot: RotorConfigurationSnapshot) {
    this.writeJournal(null); this.update({ snapshot, base: clone(snapshot), draft: clone(snapshot.configuration), pending: null,
      conflict: null, saving: false, error: "", workspaceChanged: false });
  }
  async load(legacy?: RotorConfiguration) {
    const snapshot = checkedRotorConfigurationSnapshot(await this.request("workspace_rotor_configuration_load", legacy ? { legacy } : {}));
    const { base, draft, pending } = this.state;
    if (!base || !draft) { this.accept(snapshot); return; }
    this.update({ snapshot });
    const dirty = rotorConfigurationDirty(base, draft);
    if (!sameGeneration(base.generation, snapshot.generation)) {
      if (!pending && !dirty) { this.accept(snapshot); return; }
      this.update({ conflict: snapshot, workspaceChanged: true,
        error: "The workspace was restored or replaced. Your unsaved rotor configuration is retained for review." }); return;
    }
    if (pending) { await this.reconcile(); return; }
    if (snapshot.revision !== base.revision || stable(snapshot.configuration) !== stable(base.configuration)) {
      if (!dirty) { this.accept(snapshot); return; }
      this.update({ conflict: snapshot, error: "Rotor configuration changed in another window. Your unsaved values are retained." }); return;
    }
    this.update({ conflict: null, error: "", workspaceChanged: false });
  }
  edit(configuration: RotorConfiguration) {
    if (!this.state.base || this.state.saving || this.state.pending || this.state.conflict || this.state.workspaceChanged)
      throw new Error("Resolve the current rotor configuration change before editing.");
    this.update({ draft: clone(configuration), error: "" }); this.journal(null);
  }
  async save(configuration: RotorConfiguration) {
    if (this.action) return this.action;
    const base = this.state.base;
    if (!base || this.state.pending || this.state.conflict || this.state.workspaceChanged)
      throw new Error("Resolve the current rotor configuration change before saving.");
    const mutation: RotorConfigurationMutation = { operationID: this.newID(), expectedRevision: base.revision,
      generation: base.generation, configuration: checkedRotorConfiguration(configuration) };
    this.update({ pending: mutation }); this.journal(mutation); return this.send(mutation);
  }
  private send(mutation: RotorConfigurationMutation) {
    this.update({ saving: true, error: "" });
    this.action = (async () => {
      try {
        const response = await this.request("workspace_rotor_configuration_save", mutation);
        if (response?.status === "workspace_changed") {
          this.update({ workspaceChanged: true, error: "The workspace was restored or replaced. Your rotor configuration is retained." }); return;
        }
        if (response?.status === "conflict") {
          const conflict = checkedRotorConfigurationSnapshot(response);
          this.update({ pending: null, conflict, error: "Rotor configuration changed in another window. Your unsaved values are retained." });
          this.journal(null); return;
        }
        if (response?.status !== "applied") throw new Error("The rotor configuration acknowledgement could not be verified.");
        const committed = receiptSnapshot(response.receipt, mutation, this.state.base!);
        const acknowledged = checkedRotorConfigurationSnapshot(response);
        if (stable(acknowledged) !== stable(committed)) throw new Error("The rotor configuration acknowledgement did not match its receipt.");
        this.accept(acknowledged);
      } catch (cause) {
        this.update({ error: cause instanceof Error ? cause.message : "The rotor configuration outcome is unknown. Check it before retrying." });
        throw cause;
      } finally { this.action = null; this.update({ saving: false }); }
    })();
    return this.action;
  }
  retry() {
    if (this.action) return this.action;
    if (!this.state.pending || this.state.workspaceChanged) return Promise.reject(new Error("No rotor configuration save is available to retry."));
    return this.send(this.state.pending);
  }
  async reconcile() {
    if (this.action) return this.action;
    const pending = this.state.pending; if (!pending || this.state.workspaceChanged) return;
    this.update({ saving: true });
    this.action = (async () => {
      try {
        const response = await this.request("workspace_rotor_configuration_receipt", { operationID: pending.operationID, generation: pending.generation });
        if (response?.status === "workspace_changed") {
          this.update({ workspaceChanged: true, error: "The workspace was restored or replaced. Your rotor configuration is retained." });
        } else if (response?.receipt) {
          receiptSnapshot(response.receipt, pending, this.state.base!);
          const loaded = checkedRotorConfigurationSnapshot(await this.request("workspace_rotor_configuration_load"));
          if (!sameGeneration(loaded.generation, pending.generation)) {
            this.update({ snapshot: loaded, conflict: loaded, workspaceChanged: true,
              error: "The workspace was restored or replaced. Your rotor configuration is retained." }); return;
          }
          this.accept(loaded);
        } else if (response?.receipt === null) {
          this.update({ error: "No rotor configuration receipt is available. Retry reuses the same operation ID; use saved values only to discard this edit." });
        } else throw new Error("The rotor configuration receipt response could not be verified.");
      } catch (cause) {
        this.update({ error: cause instanceof Error ? cause.message : "The rotor configuration receipt could not be verified." }); throw cause;
      } finally { this.action = null; this.update({ saving: false }); }
    })(); return this.action;
  }
  useSaved() {
    if (this.state.saving || !this.state.snapshot) throw new Error("Wait for the rotor configuration check to finish.");
    this.accept(this.state.snapshot);
  }
  clear() { this.writeJournal(null); this.update(empty()); }
}
