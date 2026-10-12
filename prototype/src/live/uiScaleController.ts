export const uiScaleKey = "xlog.integration.display-scale.v1";
export const uiScales = [1, 1.25, 1.5, 1.75, 2] as const;
export type UiScalePreference = { version: 1; scale: number; revision: number; writer: string };
export type UiScaleState = { scale: number; requestedScale: number; pending: boolean; error: string };
export type UiScaleAdapter = { applyZoom: (scale: number) => Promise<void>; read: () => string | null;
  write: (value: string) => void; publish: (value: UiScalePreference) => Promise<void>; now: () => number; writer: string };
export function parseUiScalePreference(raw: unknown): UiScalePreference | null {
  try {
    if (typeof raw === "string") { if (raw.length > 512) return null; raw = JSON.parse(raw); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    if (value.version !== 1 || !uiScales.includes(value.scale as typeof uiScales[number]) ||
      !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || (value.revision as number) >= Number.MAX_SAFE_INTEGER ||
      typeof value.writer !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(value.writer)) return null;
    return { version: 1, scale: value.scale as number, revision: value.revision as number, writer: value.writer };
  } catch { return null; }
}
const newer = (a: UiScalePreference, b: UiScalePreference) => a.revision > b.revision || a.revision === b.revision && a.writer > b.writer;
export function createUiScaleController(adapter: UiScaleAdapter) {
  let stored: UiScalePreference | null = null;
  try { stored = parseUiScalePreference(adapter.read()); } catch { /* Keep 100% usable when preference storage is restricted. */ }
  let seen = stored ?? { version: 1 as const, scale: 1, revision: 0, writer: adapter.writer };
  let state: UiScaleState = { scale: 1, requestedScale: seen.scale, pending: false, error: "" };
  let desired: { preference: UiScalePreference; persist: boolean } | null = null;
  let running = false, active = true;
  const listeners = new Set<() => void>();
  const update = (patch: Partial<UiScaleState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const repairStoredWinner = () => {
    // Equal-clock writes are ordered by writer. Repair a losing last storage
    // write only after this window successfully applied the winning record.
    if (!active || desired || state.scale !== seen.scale) return;
    try {
      const persisted = parseUiScalePreference(adapter.read());
      if (persisted && newer(seen, persisted)) adapter.write(JSON.stringify(seen));
    } catch { update({ error: "Scale applied in this window, but the preference could not be saved." }); }
  };
  const drain = async () => {
    if (running || !active) return;
    running = true;
    while (desired && active) {
      const target = desired; desired = null;
      try {
        await adapter.applyZoom(target.preference.scale);
        if (!active) break;
        update({ scale: target.preference.scale });
        // Never persist/broadcast a completion superseded by another window or click.
        if (!desired && target.preference === seen && target.persist) {
          try { adapter.write(JSON.stringify(target.preference)); }
          catch { update({ error: "Scale applied in this window, but the preference could not be saved." }); }
          try { await adapter.publish(target.preference); }
          catch { if (target.preference === seen) update({ error: `${state.error ? `${state.error} ` : ""}Scale applied here, but other windows could not be notified. Reopen them to retry.` }); }
        }
        if (!desired && target.preference === seen) repairStoredWinner();
      } catch {
        if (active && !desired && target.preference === seen) update({ error: "Display scale could not be applied. Use Reset to 100% (⌘/Ctrl+0) to retry." });
      }
    }
    running = false;
    if (active) update({ pending: false });
  };
  const queue = (preference: UiScalePreference, persist: boolean) => {
    seen = preference; desired = { preference, persist };
    update({ requestedScale: preference.scale, pending: true, error: "" }); void drain();
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start: () => queue(seen, false),
    setScale: (scale: number) => {
      if (!active) return;
      if (!uiScales.includes(scale as typeof uiScales[number])) { update({ error: "Choose a display scale from 100% to 200%." }); return; }
      const revision = Math.max(Math.floor(adapter.now()), seen.revision + 1);
      if (!Number.isSafeInteger(revision) || revision >= Number.MAX_SAFE_INTEGER) { update({ error: "Display preference could not be updated. Reset the saved preference and retry." }); return; }
      queue({ version: 1, scale, revision, writer: adapter.writer }, true);
    },
    accept: (raw: unknown) => { const value = parseUiScalePreference(raw); if (!active || !value) return; if (newer(value, seen)) queue(value, false); else if (!running) repairStoredWinner(); },
    reportSynchronizationFailure: () => { if (active) update({ error: "This window could not subscribe to display changes. Reopen it to restore synchronization." }); },
    dispose: () => { active = false; desired = null; listeners.clear(); },
  };
}
export type UiScaleController = ReturnType<typeof createUiScaleController>;
