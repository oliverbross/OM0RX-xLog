import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { builtinGuides } from "./bandMapBuiltinGuides";
import { emptyGuideDocument, parseGuide, readGuideDocument, type BandMapGuide, type GuideDocument, type GuideMarker } from "./bandMapGuides";
import { workerRequest } from "../worker";
import { checkedPreferenceReply, connectPreferenceInvalidation, type PreferenceSnapshot } from "./bandMapPreferenceTransport";
import { isTauri } from "@tauri-apps/api/core";
import { BandMapGuideEditor } from "./BandMapGuideEditor";
import { createPortal } from "react-dom";
import { guideTuneRecovery } from "./guideTuneSession";
const requestViaSession = async (method: string, params: Record<string, unknown> = {}) => (await workerRequest(method, params)).result;

export function useBandMapGuides(compact: boolean, enabled = true) {
  const [base, setBase] = useState<PreferenceSnapshot | null>(null), [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const operation = useRef(0), writing = useRef(false);
  useEffect(() => {
    if (!enabled || !isTauri()) return;
    let active = true;
    const load = async () => { const epoch = ++operation.current; try { const reply = await requestViaSession("workspace_preferences_load") as PreferenceSnapshot; if (active && epoch === operation.current) { readGuideDocument(reply.preferences.bandMapGuidesJSON); setBase(reply); } } catch (cause) { if (active && epoch === operation.current) setError(String(cause)); } };
    void load(); const stop = connectPreferenceInvalidation(() => void load());
    return () => { active = false; operation.current++; stop?.(); };
  }, [enabled]);
  let document = emptyGuideDocument();
  try { document = readGuideDocument(base?.preferences.bandMapGuidesJSON); } catch { /* Keep compatible display while native recovery is requested. */ }
  const save = async (next: GuideDocument) => {
    if (!base || writing.current) return false;
    writing.current = true;
    operation.current++;
    setBusy(true); setError("");
    try {
      const text = JSON.stringify(next); readGuideDocument(text);
      const reply = checkedPreferenceReply(await requestViaSession("workspace_band_map_apply", { generation: base.generation, scope: compact ? "desk" : "detached", expected: { guidesJSON: base.preferences.bandMapGuidesJSON ?? "" }, patch: { guidesJSON: text } }));
      operation.current++;
      setBase(reply);
      if (reply.status !== "applied") throw new Error("Guides changed in another window or workspace. Review the current values before saving again.");
      return true;
    } catch (cause) { setError(String(cause)); return false; }
    finally { writing.current = false; setBusy(false); }
  };
  return { document, save, error, ready: !!base && !busy };
}
export function BandMapGuideControls({ document, save, error, ready, compact }: ReturnType<typeof useBandMapGuides> & { compact: boolean }) {
  const [open, setOpen] = useState(false);
  const scope = compact ? "desk" : "detached", selection = document[scope];
  const profiles = [...builtinGuides, ...document.custom], selected = profiles.find(g => g.id === selection.id);
  const [editing, setEditing] = useState<string | null>(null), [importText, setImportText] = useState(""), [preview, setPreview] = useState<BandMapGuide | null>(null), [localError, setLocalError] = useState("");
  const select = (patch: Partial<typeof selection>) => void save({ ...document, [scope]: { ...selection, ...patch } });
  const add = async (guide: BandMapGuide, replace = false) => {
    try {
      if (!replace && document.custom.length >= 16) throw new Error("At most 16 custom guides are supported.");
      const next = { ...guide, origin: "custom" as const, id: replace ? guide.id : `custom-${crypto.randomUUID()}` };
      const applied = await save({ ...document, custom: [...document.custom.filter(g => g.id !== next.id), next], [scope]: { ...selection, id: next.id } });
      if (applied === false) return;
      setPreview(null); setEditing(null);
    } catch (cause) { setLocalError(String(cause)); }
  };
  return <div className="band-map-guides"><button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Guides · {selected?.name ?? "Original appearance"}</button>{createPortal(<div className="band-map-guide-options" role="dialog" aria-label="Band-map guide settings" hidden={!open}>
    <button type="button" onClick={() => setOpen(false)}>Close guide settings</button>
    <label>Visual guide<select disabled={!ready} value={selection.id} onChange={e => select({ id: e.target.value })}><option value="legacy">Original appearance</option>{profiles.map(g => <option key={g.id} value={g.id}>{g.name}{g.origin === "custom" ? " · custom" : ""}</option>)}</select></label>
    <label><input type="checkbox" disabled={!ready} checked={selection.visible} onChange={e => select({ visible: e.target.checked })} />Show guide</label>
    <label><input type="checkbox" disabled={!ready} checked={selection.beacons} onChange={e => select({ beacons: e.target.checked })} />IBP reference frequencies</label>
    <p>Visual guidance only. Mode inference and radio permissions stay independent. IBP markers do not indicate an audible beacon.</p>
    <button type="button" disabled={!ready} onClick={() => add({ version: 1, units: "Hz", id: "new", name: "My guide", region: "Personal", origin: "custom", sourceURL: "", reviewed: "", supportedBands: [], ranges: [], markers: [] })}>New custom guide</button>
    {selected && <><small>{selected.region} · reviewed {selected.reviewed}<br />{selected.sourceURL}<br />Supported: {selected.supportedBands.join(", ")}</small><button type="button" disabled={!ready} onClick={() => add({ ...selected, name: `${selected.name.slice(0, 60)} (modified copy)` })}>Duplicate as custom</button><button type="button" onClick={() => { const blob = new Blob([JSON.stringify(selected, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob), a = window.document.createElement("a"); a.href = url; a.download = `${selected.id}.xlog-guide.json`; a.click(); URL.revokeObjectURL(url); }}>Export guide JSON</button>
      {selected.origin === "custom" && <><button type="button" disabled={!ready} onClick={() => setEditing(JSON.stringify(selected, null, 2))}>Edit / rename / markers</button><button type="button" disabled={!ready} onClick={() => void save({ ...document, custom: document.custom.filter(g => g.id !== selected.id), desk: document.desk.id === selected.id ? { ...document.desk, id: "legacy" } : document.desk, detached: document.detached.id === selected.id ? { ...document.detached, id: "legacy" } : document.detached })}>Delete custom guide</button></>}
    </>}
    {editing !== null && <BandMapGuideEditor initial={parseGuide(editing)} busy={!ready} save={next => { if (next.id !== selected?.id || next.origin !== "custom") { setLocalError("Editing must preserve the selected custom ID and origin."); return; } void add(next, true); }} cancel={() => setEditing(null)} />}
    <label>Import xLog guide JSON<input type="file" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; if (!file) return; try { if (file.size > 131072) throw new Error("Guide imports are limited to 128 KiB."); setImportText(await file.text()); } catch (cause) { setLocalError(String(cause)); } }} /></label>
    <label>Or paste guide JSON<textarea aria-label="Import guide JSON" value={importText} onChange={e => setImportText(e.target.value)} rows={3} /></label><button type="button" disabled={!ready} onClick={() => { try { setPreview(parseGuide(importText)); setLocalError(""); } catch (cause) { setLocalError(String(cause)); } }}>Preview import</button>
    {preview && <div><strong>{preview.name}</strong><p>{preview.ranges.length} ranges · {preview.markers.length} markers · {preview.supportedBands.join(", ")}</p><button type="button" disabled={!ready} onClick={() => add(preview)}>Import as new copy</button>{document.custom.some(g => g.id === preview.id) && <button type="button" disabled={!ready} onClick={() => add(preview, true)}>Replace matching custom ID</button>}<button type="button" onClick={() => setPreview(null)}>Cancel import</button></div>}
    {(error || localError) && <p role="alert">{error || localError}</p>}
  </div>, window.document.body)}</div>;
}
export function GuideMarkerInspector({ marker, tune, close }: { marker: GuideMarker; tune?: (marker: GuideMarker) => Promise<unknown>; close: () => void }) {
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const recovery = useSyncExternalStore(guideTuneRecovery.subscribe, guideTuneRecovery.getSnapshot);
  const recover = async (review: boolean) => { try { await (review ? guideTuneRecovery.review() : guideTuneRecovery.check()); setError(""); } catch (cause) { setError(String(cause)); } };
  return createPortal(<div className="band-map-guide-inspector" role="group" aria-label="Guide marker details"><strong>{marker.label}</strong><span>{(marker.frequencyHz / 1e6).toFixed(6)} MHz · {marker.category} · {marker.mode ?? "keep current radio mode"}</span>{tune && <button type="button" disabled={busy || recovery.busy || !!recovery.pending} onClick={async () => { setBusy(true); try { await tune(marker); close(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); } }}>Tune selected radio</button>}<button type="button" onClick={close}>Close marker</button>{recovery.pending && <><button type="button" disabled={recovery.busy} onClick={() => void recover(false)}>Check tune status</button>{recovery.reviewable && <button type="button" disabled={recovery.busy} onClick={() => void recover(true)}>Review unknown tune</button>}</>}{recovery.message && <p role="status">{recovery.message}</p>}{error && <p role="alert">{error}</p>}</div>, window.document.body);
}
