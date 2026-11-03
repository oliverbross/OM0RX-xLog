import { useState } from "react";
import { BAND_ORDER } from "./band";
import { validateGuide, type BandMapGuide, type GuideMarker } from "./bandMapGuides";

export function BandMapGuideEditor({ initial, busy, save, cancel }: { initial: BandMapGuide; busy: boolean; save: (guide: BandMapGuide) => void; cancel: () => void }) {
  const [guide, setGuide] = useState(initial), [error, setError] = useState("");
  const range = (index: number, patch: Partial<BandMapGuide["ranges"][number]>) => setGuide(g => ({ ...g, ranges: g.ranges.map((r, i) => i === index ? { ...r, ...patch } : r) }));
  const marker = (index: number, patch: Partial<GuideMarker>) => setGuide(g => ({ ...g, markers: g.markers.map((m, i) => i === index ? { ...m, ...patch } : m) }));
  return <form className="band-map-guide-editor" aria-label="Edit custom visual guide" onSubmit={event => {
    event.preventDefault();
    try { save(validateGuide(guide)); setError(""); } catch (cause) { setError(String(cause)); }
  }}>
    <fieldset disabled={busy}><legend>Custom guide · modified reference</legend>
      <label>Name<input aria-label="Guide name" maxLength={80} value={guide.name} onChange={e => setGuide({ ...guide, name: e.target.value })} /></label>
      <label>Region label<input aria-label="Guide region label" maxLength={80} value={guide.region} onChange={e => setGuide({ ...guide, region: e.target.value })} /></label>
      <p>Frequencies are integer Hz. Source attribution is retained: {guide.sourceURL || "Personal guide"} {guide.reviewed}</p>
      <fieldset><legend>Supported bands</legend><div className="band-map-guide-bands">{BAND_ORDER.map(band => <label key={band}><input type="checkbox" checked={guide.supportedBands.includes(band)} onChange={e => setGuide({ ...guide, supportedBands: e.target.checked ? [...guide.supportedBands, band] : guide.supportedBands.filter(b => b !== band) })} />{band}</label>)}</div></fieldset>
      <h4>Ranges · {guide.ranges.length}/128</h4>
      {guide.ranges.map((r, index) => <details key={index}><summary>{index + 1}. {r.label || "Unlabelled range"} · {r.startHz}–{r.endHz} Hz</summary><div className="band-map-guide-fields">
        <label>Label<input aria-label={`Range ${index + 1} label`} maxLength={64} value={r.label} onChange={e => range(index, { label: e.target.value })} /></label>
        <label>Start Hz<input aria-label={`Range ${index + 1} start Hz`} type="number" step={1} min={100000} max={1000000000} value={r.startHz} onChange={e => range(index, { startHz: Number(e.target.value) })} /></label>
        <label>End Hz<input aria-label={`Range ${index + 1} end Hz`} type="number" step={1} min={100000} max={1000000000} value={r.endHz} onChange={e => range(index, { endHz: Number(e.target.value) })} /></label>
        <label>Color<input aria-label={`Range ${index + 1} color`} type="color" value={r.color} onChange={e => range(index, { color: e.target.value })} /></label>
        <button type="button" onClick={() => setGuide({ ...guide, ranges: guide.ranges.filter((_, i) => i !== index) })}>Remove range {index + 1}</button>
      </div></details>)}
      <button type="button" disabled={guide.ranges.length >= 128} onClick={() => setGuide({ ...guide, ranges: [...guide.ranges, { startHz: 14000000, endHz: 14070000, color: "#12a88a", label: "Personal range" }] })}>Add range</button>
      <h4>Personal markers · {guide.markers.length}/128</h4>
      {guide.markers.map((m, index) => <details key={index}><summary>{index + 1}. {m.label || "Unlabelled marker"} · {m.frequencyHz} Hz</summary><div className="band-map-guide-fields">
        <label>Label<input aria-label={`Marker ${index + 1} label`} maxLength={64} value={m.label} onChange={e => marker(index, { label: e.target.value })} /></label>
        <label>Frequency Hz<input aria-label={`Marker ${index + 1} frequency Hz`} type="number" min={100000} max={1000000000} step={1} value={m.frequencyHz} onChange={e => marker(index, { frequencyHz: Number(e.target.value) })} /></label>
        <label>Category<input aria-label={`Marker ${index + 1} category`} maxLength={32} value={m.category} onChange={e => marker(index, { category: e.target.value })} /></label>
        <label>Explicit tune mode<select aria-label={`Marker ${index + 1} tune mode`} value={m.mode ?? ""} onChange={e => marker(index, { mode: e.target.value ? e.target.value as GuideMarker["mode"] : undefined })}><option value="">Keep current radio mode</option>{["CW", "USB", "LSB", "FM", "AM"].map(mode => <option key={mode}>{mode}</option>)}</select></label>
        <button type="button" onClick={() => setGuide({ ...guide, markers: guide.markers.filter((_, i) => i !== index) })}>Remove marker {index + 1}</button>
      </div></details>)}
      <button type="button" disabled={guide.markers.length >= 128} onClick={() => setGuide({ ...guide, markers: [...guide.markers, { frequencyHz: 14025000, label: "Personal marker", category: "personal" }] })}>Add personal marker</button>
      {error && <p role="alert">{error}</p>}
      <div className="band-map-guide-editor-actions"><button type="submit">Save custom guide</button><button type="button" onClick={cancel}>Cancel editing</button></div>
    </fieldset>
  </form>;
}
