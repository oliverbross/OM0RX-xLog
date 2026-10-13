import { useEffect, useRef, useState } from "react";
import { activatePreset, deletePreset, duplicatePreset, maxWorkspacePresets, validatePresetName } from "./workspacePresetActions";
import { panelMinimum, type LayoutPreset, type LayoutSnapshot, type LayoutState, type WorkspacePanelID, type WorkspaceLayoutSession } from "./workspaceLayoutSession";
import { operatorWorkspaceKey, readWorkspacePreferences } from "./operatorWorkspacePreferences";
import "./WorkspaceSettings.css";

const names: Record<WorkspacePanelID, string> = {
  "active-qso": "Active QSO", "log-qso": "Log QSO", logbook: "Logbook", "callsign-intelligence": "Callsign intelligence",
  rotor: "Rotor", antenna: "Antenna", "world-map": "World map", "band-maps": "Band maps", "dx-cluster": "DX Cluster",
  "station-control": "Station control", "station-status": "Station status", "station-identity": "Station identity", cw: "CW macros",
  alerts: "Alerts", propagation: "HF propagation", settings: "Settings", sync: "Sync", awards: "Awards", "chaser-dx": "Chaser & DX",
  "spot-history": "Spot History", monitor: "Monitor",
};
type Draft = { base: LayoutSnapshot; preset: LayoutPreset };
type Props = { state: LayoutState; session: WorkspaceLayoutSession; subscriptionError?: string;
  available: WorkspacePanelID[]; equipment?: "rotor" | "antenna"; requiredRotor?: boolean };

export default function WorkspaceSettings({ state, session, subscriptionError, available, equipment, requiredRotor }: Props) {
  const [selection, setSelection] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removal, setRemoval] = useState<{ base: LayoutSnapshot; id: string; name: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (draft) nameInput.current?.focus(); }, [draft?.preset.id]);
  const snapshot = state.snapshot;
  const selected = snapshot?.document.presets.find(preset => preset.id === selection)
    ?? snapshot?.document.presets.find(preset => preset.id === snapshot.document.activePresetID);
  const blocked = working || state.saving || !!state.pending || state.workspaceChanged || !snapshot;
  const protectedPreset = selected?.id === "traditional" || selected?.id === "windowed";
  async function run(action: () => Promise<void> | void) {
    if (working) return;
    setWorking(true); setMessage("");
    try { await action(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The layout could not be saved. Reload and review it."); }
    finally { setWorking(false); }
  }
  function begin(copy: boolean) {
    if (!snapshot || !selected || blocked) return;
    setMessage(""); setRemoval(null);
    try {
      let preset = structuredClone(selected);
      if (copy) {
        let preferences;
        try { preferences = readWorkspacePreferences(localStorage.getItem(operatorWorkspaceKey)); } catch { /* Safe defaults when storage is unavailable. */ }
        const change = duplicatePreset(snapshot.document, selected.id, `desk-${crypto.randomUUID()}`, "New layout", { equipment, preferences });
        if (change.action !== "savePreset") return;
        preset = change.preset;
      }
      setDraft({ base: structuredClone(snapshot), preset });
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The layout could not be copied."); }
  }
  function update(patch: Partial<LayoutPreset>) { setDraft(current => current && ({ ...current, preset: { ...current.preset, ...patch } })); }
  function visibility(id: WorkspacePanelID, visible: boolean) {
    if (!draft || !available.includes(id) || (id === "rotor" && requiredRotor && !visible)) return;
    const preset = structuredClone(draft.preset), panel = preset.panels.find(item => item.id === id)!;
    if (panel.placement === "window") return;
    panel.placement = visible ? "canvas" : "hidden";
    if (visible) {
      const [width, height] = panelMinimum(id);
      panel.rect = { ...panel.rect, width: Math.max(width, panel.rect.width), height: Math.max(height, panel.rect.height) };
      panel.rect.x = Math.min(panel.rect.x, Math.max(0, preset.width - panel.rect.width));
      panel.rect.y = Math.min(panel.rect.y, Math.max(0, preset.height - panel.rect.height));
      preset.width = Math.max(preset.width, panel.rect.width); preset.height = Math.max(preset.height, panel.rect.height);
    }
    update(preset);
  }
  async function save() {
    if (!draft || blocked) return;
    const preset = { ...draft.preset, name: validatePresetName(draft.preset.name) };
    if (requiredRotor && preset.panels.find(panel => panel.id === "rotor")?.placement === "hidden") throw new Error("Show the connected rotor before saving this layout.");
    await session.applyAtBase({ action: "savePreset", presetID: preset.id, preset }, draft.base);
    const result = session.getSnapshot();
    if (!result.pending && !result.error) { setSelection(preset.id); setDraft(null); setMessage(result.snapshot?.document.activePresetID === preset.id ? "Layout saved." : "Layout saved. Use layout to switch arrangements."); }
  }
  return <section className="workspace-settings" aria-label="Workspace arrangements" aria-busy={working || state.saving}>
    <div className="workspace-preset-toolbar">
      <label>Saved layout<select aria-label="Saved layout" value={selected?.id ?? ""} disabled={!snapshot || !!draft || !!removal || blocked} onChange={event => { setSelection(event.target.value); setMessage(""); }}>
        {!snapshot && <option value="">Loading layouts…</option>}
        {snapshot?.document.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}{snapshot.document.activePresetID === preset.id ? " · active" : ""}</option>)}
      </select></label>
      <div className="workspace-preset-actions">
        <button type="button" disabled={blocked || !!draft || !!removal || selected?.id === "windowed" || selected?.id === snapshot?.document.activePresetID} onClick={() => void run(async () => {
          if (snapshot && selected) await session.applyAtBase(activatePreset(snapshot.document, selected.id), snapshot);
        })}>Use layout</button>
        <button type="button" disabled={blocked || !!draft || !!removal || (snapshot?.document.presets.length ?? 0) >= maxWorkspacePresets || selected?.id === "windowed"} onClick={() => begin(true)}>Duplicate layout</button>
        <button type="button" disabled={blocked || !!draft || !!removal || protectedPreset} onClick={() => begin(false)}>Edit layout</button>
        <button type="button" disabled={blocked || !!draft || !!removal || protectedPreset || selected?.id === snapshot?.document.activePresetID} onClick={() => { if (snapshot && selected) setRemoval({ base: structuredClone(snapshot), id: selected.id, name: selected.name }); }}>Delete layout</button>
      </div>
    </div>
    {!draft && !removal && <p className="workspace-settings-help">{selected?.id === "windowed" ? "Full windowed restoration is not available yet. Existing window placements are retained." : protectedPreset
      ? "Traditional keeps the familiar docked desk. Duplicate it to choose panels and arrange your own workspace."
      : "Use this layout on the Operator Desk. Edit its panels here; move and resize them on the desk with Arrange panels."}</p>}
    {removal && <div className="workspace-remove"><p>Delete “{removal.name}”? Other layouts and your contacts stay unchanged.</p>
      <button type="button" disabled={blocked} onClick={() => void run(async () => {
        await session.applyAtBase(deletePreset(removal.base.document, removal.id), removal.base);
        if (!session.getSnapshot().pending && !session.getSnapshot().error) { setRemoval(null); setSelection(""); setMessage("Layout deleted."); }
      })}>Confirm delete</button> <button type="button" disabled={working || state.saving || !!state.pending} onClick={() => setRemoval(null)}>Cancel deletion</button></div>}
    {draft && <form className="workspace-preset-editor" onSubmit={event => { event.preventDefault(); void run(save); }}>
      <fieldset disabled={blocked}><label className="workspace-name">Layout name<input ref={nameInput} value={draft.preset.name} onChange={event => update({ name: event.target.value })} /></label>
        <div className="workspace-layout-options"><label><input type="checkbox" checked={draft.preset.locked} onChange={event => update({ locked: event.target.checked })} />Lock panel positions</label>
          <label><input type="checkbox" checked={draft.preset.snap} onChange={event => update({ snap: event.target.checked })} />Snap to grid</label></div>
        <h3>Operator Desk panels</h3><p className="workspace-settings-help">Choose what appears on the canvas. Position and resize panels on the Operator Desk.</p>
        <div className="workspace-panel-options">{draft.preset.panels.filter(panel => available.includes(panel.id)).map(panel => <label key={panel.id}>
          <input type="checkbox" checked={panel.placement === "canvas"} disabled={panel.placement === "window" || (panel.id === "rotor" && requiredRotor && panel.placement === "canvas")} onChange={event => visibility(panel.id, event.target.checked)} />
          {names[panel.id]}{panel.placement === "window" ? " · separate window retained" : panel.id === "rotor" && requiredRotor ? " · connected rotor required" : ""}
        </label>)}</div>
        <details className="workspace-retained"><summary>Other panel placements retained</summary><ul>{draft.preset.panels.filter(panel => !available.includes(panel.id)).map(panel => <li key={panel.id}>{names[panel.id]} — {panel.placement}; unavailable on this canvas</li>)}</ul></details>
      </fieldset>
      <button className="primary" type="submit" disabled={blocked}>Save layout</button>
      <button type="button" disabled={working || state.saving || !!state.pending} onClick={() => { setDraft(null); setMessage(""); }}>Cancel editing</button>
    </form>}
    {(message || state.error || subscriptionError) && <p role="status" className="workspace-settings-feedback">{message || state.error || subscriptionError}</p>}
    {draft && message && !state.pending && <p>Your edits are retained. To review the current saved layout, cancel editing and open Edit layout again.</p>}
    {(state.pending || state.error || subscriptionError || !snapshot) && <div className="workspace-recovery">
      <button type="button" disabled={working || state.saving} onClick={() => void run(() => session.refresh())}>Reload saved layouts</button>
      {state.pending && <><button type="button" disabled={working || state.saving || !!state.conflict || state.workspaceChanged} onClick={() => void run(async () => {
        await session.retry();
        if (!session.getSnapshot().pending && !session.getSnapshot().error) { if (draft) setSelection(draft.preset.id); setDraft(null); setRemoval(null); setMessage("Layout change confirmed."); }
      })}>Retry layout change</button>
        <button type="button" disabled={working || state.saving} onClick={() => void run(async () => { await session.discard(); if (!session.getSnapshot().pending && !session.getSnapshot().error) { setDraft(null); setRemoval(null); setMessage("Using saved layouts. Unsaved layout changes discarded."); } })}>Use saved layouts</button></>}
    </div>}
  </section>;
}
