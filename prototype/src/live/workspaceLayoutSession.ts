const version1PanelIDs = ["active-qso", "log-qso", "logbook", "callsign-intelligence", "rotor", "antenna",
  "world-map", "band-maps", "dx-cluster", "station-control", "station-status", "station-identity", "cw", "alerts",
  "propagation", "settings", "sync", "awards", "chaser-dx"] as const;
export const workspacePanelIDs = [...version1PanelIDs, "spot-history", "monitor"] as const;
export type WorkspacePanelID = typeof workspacePanelIDs[number];
export type LayoutRect = { x: number; y: number; width: number; height: number };
export type PanelLayout = { id: WorkspacePanelID; placement: "canvas" | "window" | "hidden"; rect: LayoutRect; z: number };
export type LayoutPreset = { id: string; name: string; width: number; height: number; locked: boolean; snap: boolean; panels: PanelLayout[] };
export type LayoutDocument = { version: 2; activePresetID: string; presets: LayoutPreset[] };
export type LayoutSnapshot = { revision: number; generation: string; document: LayoutDocument };
export type LayoutChange = { action: "placePanel"; presetID: string; panel: PanelLayout } |
  { action: "savePreset"; presetID: string; preset: LayoutPreset } |
  { action: "activatePreset" | "deletePreset"; presetID: string };
export type LayoutJournal = { base: LayoutSnapshot; change: LayoutChange };
export type LayoutState = { snapshot: LayoutSnapshot | null; pending: LayoutJournal | null; conflict: LayoutSnapshot | null;
  saving: boolean; error: string; workspaceChanged: boolean };
type Request = (method: "workspace_layout_load" | "workspace_layout_apply", params?: Record<string, unknown>) => Promise<any>;
const object = (value: any) => value !== null && typeof value === "object" && !Array.isArray(value);
const integer = (value: any, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max;
const number = (value: any, min: number, max: number) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const generation = (value: any): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const sameGeneration = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const clone = <T>(value: T): T => structuredClone(value);
const stable = (value: any): string => JSON.stringify(value, (_key, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sameDocument = (a: LayoutDocument, b: LayoutDocument) => stable(a) === stable(b);
export function panelMinimum(id: WorkspacePanelID): [number, number] {
  if (id === "active-qso") return [520, 240];
  if (id === "callsign-intelligence") return [360, 240];
  if (["rotor", "antenna"].includes(id)) return [240, 240];
  if (["world-map", "band-maps", "dx-cluster"].includes(id)) return [280, 200];
  if (["station-status", "station-identity", "propagation", "cw", "alerts"].includes(id)) return [240, 80];
  return [640, 480];
}
export function validLayoutDocument(value: any): value is LayoutDocument {
  return validDocument(value, 2, workspacePanelIDs);
}
function validDocument(value: any, version: number, ids: readonly WorkspacePanelID[]): boolean {
  if (!object(value) || value.version !== version || !Array.isArray(value.presets) || !integer(value.presets.length, 1, 12) ||
      new Set(value.presets.map((preset: any) => preset?.id)).size !== value.presets.length ||
      !value.presets.some((preset: any) => preset?.id === value.activePresetID)) return false;
  return value.presets.every((preset: any) => {
    if (!object(preset) || typeof preset.id !== "string" || !/^[a-z0-9-]{1,64}$/.test(preset.id) ||
        typeof preset.name !== "string" || !preset.name.trim() || new TextEncoder().encode(preset.name).length > 100 || /[\p{Cc}\p{Cf}]/u.test(preset.name) ||
        !number(preset.width, 640, 16384) || !number(preset.height, 480, 16384) || typeof preset.locked !== "boolean" || typeof preset.snap !== "boolean" ||
        !Array.isArray(preset.panels) || preset.panels.length !== ids.length || new Set(preset.panels.map((panel: any) => panel?.id)).size !== ids.length) return false;
    return preset.panels.every((panel: any) => {
      if (!object(panel) || !ids.includes(panel.id) || !["canvas", "window", "hidden"].includes(panel.placement) ||
          !integer(panel.z, 0, 10000) || !object(panel.rect)) return false;
      const r = panel.rect, [width, height] = panelMinimum(panel.id);
      return number(r.x, 0, 16384) && number(r.y, 0, 16384) && number(r.width, width, 16384) && number(r.height, height, 16384) &&
        (panel.placement !== "canvas" || r.x + r.width <= preset.width && r.y + r.height <= preset.height);
    });
  });
}
/** Version upgrades change representation, not the operator's revision or
 * placements. A v1 backup/journal gains only the two newly known hidden roles. */
export function migratedLayoutDocument(value: any): LayoutDocument {
  if (validLayoutDocument(value)) return clone(value);
  if (!validDocument(value, 1, version1PanelIDs)) throw new Error("The shared workspace layout could not be verified.");
  const document = clone(value);
  document.version = 2;
  for (const preset of document.presets) {
    for (const [offset, id] of (["spot-history", "monitor"] as const).entries()) {
      preset.panels.push({ id, placement: "hidden", rect: { x: 0, y: 0, width: 640, height: 480 }, z: version1PanelIDs.length + offset });
    }
  }
  return document;
}
export function checkedLayout(value: any): LayoutSnapshot {
  if (!object(value) || !generation(value.generation) || !integer(value.revision, 0, Number.MAX_SAFE_INTEGER))
    throw new Error("The shared workspace layout could not be verified.");
  return { ...clone(value), document: migratedLayoutDocument(value.document) };
}
export function changedLayout(base: LayoutDocument, change: LayoutChange): LayoutDocument {
  const invalid = () => { throw new Error("Invalid workspace layout change."); };
  if (!object(change)) return invalid();
  const document = clone(base), index = document.presets.findIndex(preset => preset.id === change.presetID);
  if (change.action === "placePanel") {
    if (index < 0 || !object(change.panel)) return invalid();
    const item = document.presets[index].panels.findIndex(panel => panel.id === change.panel.id);
    if (item < 0) return invalid();
    document.presets[index].panels[item] = clone(change.panel);
  } else if (change.action === "savePreset") {
    if (change.preset?.id !== change.presetID) return invalid();
    if (index < 0) document.presets.push(clone(change.preset)); else document.presets[index] = clone(change.preset);
  } else if (change.action === "activatePreset") {
    if (index < 0) return invalid(); document.activePresetID = change.presetID;
  } else if (change.action === "deletePreset") {
    if (index < 0 || document.activePresetID === change.presetID) return invalid(); document.presets.splice(index, 1);
  } else return invalid();
  if (!validLayoutDocument(document)) return invalid();
  return document;
}
export function readLayoutJournal(raw: string | null): LayoutJournal | null {
  if (!raw || raw.length > 300_000) return null;
  try {
    const value = JSON.parse(raw), base = checkedLayout(value.base);
    let change = clone(value.change);
    if (value.base.document.version === 1) {
      if (change?.action === "savePreset") {
        const migrated = migratedLayoutDocument({ version: 1, activePresetID: change.presetID, presets: [change.preset] });
        change = { ...change, preset: migrated.presets[0] };
      } else if (change?.action === "placePanel" && !version1PanelIDs.includes(change.panel?.id)) return null;
    }
    changedLayout(base.document, change);
    return { base, change };
  } catch { return null; }
}
export class LayoutRequestRejected extends Error {}

/** Shared data only: opening, closing or moving native windows is a separate
 * reconciler. Neither recovery nor subscriptions replay a layout mutation. */
export class WorkspaceLayoutSession {
  private state: LayoutState;
  private listeners = new Set<() => void>();
  private reading: Promise<void> | null = null;
  private again = false;
  private epoch = 0;
  private recovering = false;
  constructor(private request: Request, private journal: (value: LayoutJournal | null) => void = () => {}, pending: LayoutJournal | null = null) {
    this.state = { snapshot: null, pending: clone(pending), conflict: null, saving: false, error: "", workspaceChanged: false };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<LayoutState>) { this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener()); }
  private accept(value: LayoutSnapshot) {
    const pending = this.state.pending, current = this.state.snapshot;
    if (current && sameGeneration(current.generation, value.generation) && current.revision > value.revision) return;
    if (!pending) { this.update({ snapshot: value, conflict: null, workspaceChanged: false, error: "" }); return; }
    if (!sameGeneration(pending.base.generation, value.generation)) {
      this.update({ snapshot: value, workspaceChanged: true, conflict: value, error: "The workspace was restored or replaced. Review its layout before discarding or reapplying your change." }); return;
    }
    const desired = changedLayout(pending.base.document, pending.change);
    if (value.revision === pending.base.revision + 1 && sameDocument(value.document, desired)) {
      this.journal(null); this.update({ snapshot: value, pending: null, conflict: null, workspaceChanged: false, error: "" });
    } else if (value.revision === pending.base.revision && sameDocument(value.document, pending.base.document)) {
      this.update({ snapshot: value, conflict: null, error: "The layout change is not confirmed. Review it, then retry or discard it." });
    } else this.update({ snapshot: value, conflict: value, error: "Another window changed the layout. Your intended change is retained for review." });
  }
  refresh = (): Promise<void> => {
    if (this.state.saving || this.recovering) { this.again = true; return Promise.resolve(); }
    if (this.reading) { this.again = true; return this.reading; }
    this.reading = (async () => {
      do {
        this.again = false;
        const epoch = this.epoch;
        try {
          const value = checkedLayout((await this.request("workspace_layout_load")).layout);
          if (epoch === this.epoch) this.accept(value);
        } catch (cause) { if (epoch === this.epoch) this.update({ error: cause instanceof Error ? cause.message : "Shared layout unavailable." }); }
      } while (this.again && !this.state.saving && !this.recovering);
    })().finally(() => { this.reading = null; });
    return this.reading;
  };
  async apply(change: LayoutChange) {
    if (!this.state.snapshot || this.state.pending || this.state.saving || this.recovering || this.state.workspaceChanged)
      throw new Error("Resolve the current layout change before making another.");
    changedLayout(this.state.snapshot.document, change);
    const pending = { base: clone(this.state.snapshot), change: clone(change) };
    // Recovery must be durable before sending a potentially successful write.
    this.journal(pending); this.update({ pending });
    await this.send(pending);
  }
  private async send(pending: LayoutJournal) {
    this.epoch++; this.update({ saving: true, error: "", conflict: null });
    try {
      const response = await this.request("workspace_layout_apply", { ...pending.change,
        expectedRevision: pending.base.revision, generation: pending.base.generation });
      if (response.status === "workspace_changed" && generation(response.generation) && !sameGeneration(response.generation, pending.base.generation)) {
        this.update({ workspaceChanged: true, error: "The workspace was restored or replaced. Review the layout before continuing." });
      } else if (response.status === "applied" || response.status === "conflict") {
        const value = checkedLayout(response.layout);
        if (response.status === "applied" && (!sameGeneration(value.generation, pending.base.generation) ||
            value.revision !== pending.base.revision + 1 || !sameDocument(value.document, changedLayout(pending.base.document, pending.change))))
          throw new Error("The layout acknowledgement did not match the intended change. Reload to reconcile it.");
        this.accept(value);
      } else throw new Error("The layout outcome could not be verified. Reload to reconcile it.");
    } catch (cause) {
      this.update({ error: cause instanceof Error ? cause.message : "The layout outcome is unknown. Reload before retrying." });
    } finally {
      this.update({ saving: false });
      if (this.again) void this.refresh();
    }
  }
  /** Explicit user action only, after a fresh read proves the base is still current. */
  async retry() {
    if (this.state.saving || this.recovering) throw new Error("Wait for the current layout request.");
    this.recovering = true; this.epoch++;
    try {
      // A failed read must reject this action, never reuse a cached base.
      this.accept(checkedLayout((await this.request("workspace_layout_load")).layout));
      const { pending, snapshot, conflict, workspaceChanged } = this.state;
      if (!pending) return;
      if (!snapshot || conflict || workspaceChanged || !sameGeneration(snapshot.generation, pending.base.generation) ||
          snapshot.revision !== pending.base.revision || !sameDocument(snapshot.document, pending.base.document))
        throw new Error("Review the changed workspace before retrying.");
      await this.send(pending);
    } finally { this.recovering = false; if (this.again) void this.refresh(); }
  }
  async discard() {
    if (this.state.saving || this.recovering) throw new Error("Wait for the current layout request.");
    this.recovering = true; this.epoch++;
    try {
      // An explicit discard adopts a verified fresh snapshot; it performs no write.
      const value = checkedLayout((await this.request("workspace_layout_load")).layout);
      this.journal(null);
      this.update({ snapshot: value, pending: null, conflict: null, workspaceChanged: false, error: "" });
    } finally { this.recovering = false; if (this.again) void this.refresh(); }
  }
}
