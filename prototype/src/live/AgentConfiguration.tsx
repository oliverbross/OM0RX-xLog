import { useEffect, useMemo, useState } from "react";
import "./AgentConfiguration.css";

type ObjectValue = Record<string, any>;
type Props = { config: ObjectValue; onSave: (nextConfig: ObjectValue) => Promise<unknown>; busy?: boolean };
type Change = { label: string; before: string; after: string };
const bands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"];
const bandFields = [
  ["policy.flex_antenna.bands", "FLEX TX"], ["policy.kat_antenna", "KAT out"],
  ["policy.amplifier_drive_w", "PA W"], ["policy.barefoot_drive_w", "Bare W"],
  ["policy.digital_amplifier_drive_w", "Digital W"],
] as const;
const scalarFields = [
  ["flex.model", "FLEX model"], ["flex.station_name", "Maestro station"], ["flex.host", "FLEX host"],
  ["flex.port", "FLEX TCP port"], ["flex.slice_id", "FLEX slice"],
  ["kpa500.enabled", "KPA500 enabled"], ["kpa500.port", "KPA500 serial port"], ["kpa500.baudrate", "KPA500 baud"],
  ["kat500.enabled", "KAT500 enabled"], ["kat500.port", "KAT500 serial port"], ["kat500.baudrate", "KAT500 baud"],
  ["commissioned", "Commissioned"], ["policy.follow_radio", "Follow FLEX"],
  ["policy.flex_antenna.enabled", "Enforce FLEX antenna policy"],
  ["policy.digital_kpa_policy", "Digital PA policy"],
  ["policy.tune_power_w", "Tune power"], ["policy.tune_target_swr", "Target SWR"],
  ["policy.tune_abort_swr", "Abort SWR"], ["policy.tune_timeout_seconds", "Tune timeout"],
  ["policy.kat_antenna_names.1", "KAT ANT1 name"], ["policy.kat_antenna_names.2", "KAT ANT2 name"],
  ["policy.kat_antenna_names.3", "KAT ANT3 name"],
] as const;
const numericRules: Record<string, [number, number, boolean]> = {
  "flex.port": [1, 65535, true], "flex.slice_id": [0, 7, true],
  "kpa500.baudrate": [300, 1000000, true], "kat500.baudrate": [300, 1000000, true],
  "policy.tune_power_w": [1, 100, true], "policy.tune_target_swr": [0.1, 20, false],
  "policy.tune_abort_swr": [0.1, 20, false], "policy.tune_timeout_seconds": [0.1, 600, false],
};
const clone = (value: ObjectValue): ObjectValue => JSON.parse(JSON.stringify(value));
const get = (value: ObjectValue, path: string): any => path.split(".").reduce((item, key) => item?.[key], value);
const set = (value: ObjectValue, path: string, next: unknown): ObjectValue => {
  const result = clone(value); const parts = path.split("."); let cursor = result;
  for (const key of parts.slice(0, -1)) { if (!cursor[key] || typeof cursor[key] !== "object") cursor[key] = {}; cursor = cursor[key]; }
  cursor[parts.at(-1)!] = next; return result;
};
const display = (value: unknown): string => value === undefined ? "(missing)" : typeof value === "boolean" ? (value ? "On" : "Off") : String(value);
const validNumber = (value: unknown, [min, max, integer]: [number, number, boolean]): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
function validate(config: ObjectValue, drafts: Record<string, string>): string[] {
  const errors: string[] = [];
  if (Object.keys(drafts).some((path) => !validNumber(Number(drafts[path]), numericRules[path] ?? [1, 100, true]) || drafts[path].trim() === "")) errors.push("Enter valid numbers in every numeric field.");
  for (const [path, rule] of Object.entries(numericRules)) if (!validNumber(get(config, path), rule)) errors.push(`${path} is outside its supported range.`);
  for (const [path, label] of scalarFields) if (["flex.model", "flex.station_name", "flex.host", "kpa500.port", "kat500.port", "policy.kat_antenna_names.1", "policy.kat_antenna_names.2", "policy.kat_antenna_names.3"].includes(path) && !String(get(config, path) ?? "").trim()) errors.push(`${label} is required.`);
  if (get(config, "flex.model") !== "FLEX-8400") errors.push("Only FLEX-8400 is supported by this station profile.");
  if (!["operate", "standby"].includes(get(config, "policy.digital_kpa_policy"))) errors.push("Select Operate or Standby for digital PA.");
  if (get(config, "policy.tune_abort_swr") <= get(config, "policy.tune_target_swr")) errors.push("Abort SWR must exceed target SWR.");
  if (get(config, "commissioned") && ["kpa500.enabled", "kat500.enabled", "policy.follow_radio", "policy.flex_antenna.enabled"].some((path) => get(config, path) !== true)) errors.push("A commissioned profile requires both accessories, Follow FLEX, and FLEX antenna enforcement.");
  for (const band of bands) {
    if (!["ANT1", "ANT2", "XVTR"].includes(get(config, `policy.flex_antenna.bands.${band}`))) errors.push(`${band} FLEX antenna is invalid.`);
    if (![1, 2, 3].includes(get(config, `policy.kat_antenna.${band}`))) errors.push(`${band} KAT output is invalid.`);
    for (const key of ["amplifier_drive_w", "barefoot_drive_w", "digital_amplifier_drive_w"]) if (!validNumber(get(config, `policy.${key}.${band}`), [1, 100, true])) errors.push(`${band} ${key} must be 1–100 W.`);
  }
  for (const key of ["amplifier_allowed_bands", "digital_amplifier_allowed_bands"]) if (!Array.isArray(get(config, `policy.${key}`)) || get(config, `policy.${key}`).some((band: unknown) => !bands.includes(String(band)))) errors.push(`${key} contains an unsupported band.`);
  return errors;
}
function changes(original: ObjectValue, draft: ObjectValue): Change[] {
  const result: Change[] = [];
  const compare = (path: string, label: string) => { const before = get(original, path); const after = get(draft, path); if (JSON.stringify(before) !== JSON.stringify(after)) result.push({ label, before: display(before), after: display(after) }); };
  for (const [path, label] of scalarFields) compare(path, label);
  for (const band of bands) {
    for (const [path, label] of bandFields) compare(`${path}.${band}`, `${band} ${label}`);
    for (const [path, label] of [["policy.amplifier_allowed_bands", "PA allowed"], ["policy.digital_amplifier_allowed_bands", "Digital PA allowed"]] as const) {
      const before = get(original, path)?.includes(band) ?? false; const after = get(draft, path)?.includes(band) ?? false;
      if (before !== after) result.push({ label: `${band} ${label}`, before: display(before), after: display(after) });
    }
  }
  return result;
}

export function AgentConfiguration({ config, onSave, busy = false }: Props) {
  const [original, setOriginal] = useState<ObjectValue>(() => clone(config));
  const [draft, setDraft] = useState<ObjectValue>(() => clone(config));
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [incomingChanged, setIncomingChanged] = useState(false);
  const diff = useMemo(() => changes(original, draft), [original, draft]);
  const errors = useMemo(() => validate(draft, numericDrafts), [draft, numericDrafts]);
  useEffect(() => {
    if (JSON.stringify(config) === JSON.stringify(original)) return;
    if (diff.length || Object.keys(numericDrafts).length) { setIncomingChanged(true); return; }
    setOriginal(clone(config)); setDraft(clone(config)); setReviewing(false); setIncomingChanged(false);
  }, [config, original, diff.length, numericDrafts]);
  const update = (path: string, next: unknown) => { setDraft((value) => set(value, path, next)); setReviewing(false); setError(""); setNotice(""); };
  const updateNumber = (path: string, text: string, rule: [number, number, boolean]) => {
    setNumericDrafts((value) => ({ ...value, [path]: text }));
    if (text.trim() && validNumber(Number(text), rule)) update(path, Number(text)); else setReviewing(false);
  };
  const field = (label: string, path: string, type: "text" | "number" = "text", rule?: [number, number, boolean]) => <label className="agent-field" key={path}><span>{label}</span><input type={type} aria-label={label} value={type === "number" ? numericDrafts[path] ?? String(get(draft, path) ?? "") : get(draft, path) ?? ""} min={rule?.[0]} max={rule?.[1]} step={rule?.[2] ? 1 : 0.1} onChange={(event) => type === "number" ? updateNumber(path, event.target.value, rule!) : update(path, event.target.value)} disabled={busy || saving} /></label>;
  const toggle = (label: string, path: string) => <label className="agent-toggle" key={path}><input type="checkbox" checked={get(draft, path) === true} onChange={(event) => update(path, event.target.checked)} disabled={busy || saving} /><span>{label}</span></label>;
  const membership = (band: string, key: string, label: string) => <label className="agent-band-toggle"><input type="checkbox" aria-label={`${band} ${label}`} checked={(get(draft, `policy.${key}`) ?? []).includes(band)} disabled={busy || saving} onChange={(event) => { const old = get(draft, `policy.${key}`) as string[]; update(`policy.${key}`, bands.filter((item) => item === band ? event.target.checked : old.includes(item))); }} /><span className="agent-visually-hidden">{band} {label}</span></label>;
  const reset = () => { setOriginal(clone(config)); setDraft(clone(config)); setNumericDrafts({}); setReviewing(false); setIncomingChanged(false); setError(""); setNotice(""); };
  const save = async () => {
    if (!reviewing || errors.length || !diff.length || incomingChanged || busy || saving) return;
    setSaving(true); setError(""); setNotice("");
    try { await onSave(clone(draft)); setOriginal(clone(draft)); setNumericDrafts({}); setReviewing(false); setNotice("Configuration save returned successfully. Re-load from the agent to confirm the active profile."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Configuration save failed. Review the agent state and retry."); }
    finally { setSaving(false); }
  };
  return <section className="agent-config" aria-label="Remote Station Agent configuration">
    <header className="agent-config-head"><div><h3>Remote Station Agent configuration</h3><p>Edits remain local until you review and save. Saving a profile does not prove the station has applied it.</p></div><span>{get(draft, "commissioned") ? "Commissioned profile" : "Uncommissioned profile"}</span></header>
    {incomingChanged && <p className="agent-warning" role="alert">The agent configuration changed while you were editing. Reload this profile before saving to avoid overwriting newer settings.</p>}
    <div className="agent-config-grid"><fieldset><legend>FLEX / Maestro</legend><div className="agent-fields">{field("FLEX model", "flex.model")}{field("Maestro station", "flex.station_name")}{field("FLEX host", "flex.host")}{field("FLEX TCP port", "flex.port", "number", numericRules["flex.port"])}{field("FLEX slice", "flex.slice_id", "number", numericRules["flex.slice_id"])}</div>{toggle("Enforce antenna policy", "policy.flex_antenna.enabled")}</fieldset>
      <fieldset><legend>Station hardware</legend><div className="agent-device"><h4>KPA500</h4>{toggle("KPA500 enabled", "kpa500.enabled")}{field("KPA500 serial port", "kpa500.port")}{field("KPA500 baud", "kpa500.baudrate", "number", numericRules["kpa500.baudrate"])}</div><div className="agent-device"><h4>KAT500</h4>{toggle("KAT500 enabled", "kat500.enabled")}{field("KAT500 serial port", "kat500.port")}{field("KAT500 baud", "kat500.baudrate", "number", numericRules["kat500.baudrate"])}</div><div className="agent-switches">{toggle("Follow FLEX", "policy.follow_radio")}{toggle("Commissioned", "commissioned")}</div></fieldset>
      <fieldset><legend>Tune and digital</legend><div className="agent-fields">{field("Tune power W", "policy.tune_power_w", "number", numericRules["policy.tune_power_w"])}{field("Target SWR", "policy.tune_target_swr", "number", numericRules["policy.tune_target_swr"])}{field("Abort SWR", "policy.tune_abort_swr", "number", numericRules["policy.tune_abort_swr"])}{field("Tune timeout s", "policy.tune_timeout_seconds", "number", numericRules["policy.tune_timeout_seconds"])}<label className="agent-field"><span>Digital PA policy</span><select aria-label="Digital PA policy" value={get(draft, "policy.digital_kpa_policy") ?? ""} disabled={busy || saving} onChange={(event) => update("policy.digital_kpa_policy", event.target.value)}><option value="operate">Operate</option><option value="standby">Standby</option></select></label></div></fieldset></div>
    <div className="agent-routing-head"><h4>Band routing and drive</h4><div>{[1, 2, 3].map((index) => field(`KAT ANT${index} name`, `policy.kat_antenna_names.${index}`))}</div></div>
    <div className="agent-table-scroll"><table className="agent-band-table"><thead><tr><th scope="col">Band</th><th scope="col">FLEX TX</th><th scope="col">KAT out</th><th scope="col">PA</th><th scope="col">PA W</th><th scope="col">Bare W</th><th scope="col">Digital PA</th><th scope="col">Digital W</th></tr></thead><tbody>{bands.map((band) => <tr key={band}><th scope="row">{band}</th><td><select aria-label={`${band} FLEX TX antenna`} value={get(draft, `policy.flex_antenna.bands.${band}`) ?? ""} disabled={busy || saving} onChange={(event) => update(`policy.flex_antenna.bands.${band}`, event.target.value)}>{["ANT1", "ANT2", "XVTR"].map((item) => <option key={item}>{item}</option>)}</select></td><td><select aria-label={`${band} KAT output`} value={get(draft, `policy.kat_antenna.${band}`) ?? ""} disabled={busy || saving} onChange={(event) => update(`policy.kat_antenna.${band}`, Number(event.target.value))}>{[1, 2, 3].map((item) => <option key={item} value={item}>ANT{item}</option>)}</select></td><td>{membership(band, "amplifier_allowed_bands", "amplifier allowed")}</td>{["amplifier_drive_w", "barefoot_drive_w"].map((key) => <td key={key}><input type="number" aria-label={`${band} ${key === "amplifier_drive_w" ? "PA W" : "Bare W"}`} min={1} max={100} step={1} value={numericDrafts[`policy.${key}.${band}`] ?? String(get(draft, `policy.${key}.${band}`) ?? "")} disabled={busy || saving} onChange={(event) => updateNumber(`policy.${key}.${band}`, event.target.value, [1, 100, true])} /></td>)}<td>{membership(band, "digital_amplifier_allowed_bands", "digital amplifier allowed")}</td><td><input type="number" aria-label={`${band} Digital W`} min={1} max={100} step={1} value={numericDrafts[`policy.digital_amplifier_drive_w.${band}`] ?? String(get(draft, `policy.digital_amplifier_drive_w.${band}`) ?? "")} disabled={busy || saving} onChange={(event) => updateNumber(`policy.digital_amplifier_drive_w.${band}`, event.target.value, [1, 100, true])} /></td></tr>)}</tbody></table></div>
    {errors.length > 0 && <div className="agent-validation" role="alert"><strong>Correct before review</strong><ul>{errors.slice(0, 6).map((item) => <li key={item}>{item}</li>)}{errors.length > 6 && <li>{errors.length - 6} additional band values need attention.</li>}</ul></div>}
    {error && <p className="agent-error" role="alert">{error}</p>}{notice && <p className="agent-notice" role="status">{notice}</p>}
    <div className="agent-actions"><span>{diff.length ? `${diff.length} pending change${diff.length === 1 ? "" : "s"}` : "No changes"}</span><button type="button" onClick={reset} disabled={busy || saving || (!diff.length && !incomingChanged)}>Discard / reload</button><button type="button" onClick={() => setReviewing(true)} disabled={busy || saving || errors.length > 0 || diff.length === 0 || incomingChanged}>Review changes</button></div>
    {reviewing && <section className="agent-review" aria-label="Configuration change review"><h4>Review before saving</h4><p>Only the listed fields changed. Unedited fields in the supplied configuration are retained in the save payload.</p><div className="agent-review-list">{diff.map((item) => <div key={item.label}><strong>{item.label}</strong><span>{item.before}</span><span aria-hidden="true">→</span><b>{item.after}</b></div>)}</div><div className="agent-review-actions"><button type="button" onClick={() => setReviewing(false)} disabled={saving}>Back to edit</button><button type="button" className="agent-save" onClick={() => void save()} disabled={busy || saving || errors.length > 0 || incomingChanged}>{saving ? "Saving…" : "Save reviewed configuration"}</button></div></section>}
  </section>;
}

export default AgentConfiguration;
