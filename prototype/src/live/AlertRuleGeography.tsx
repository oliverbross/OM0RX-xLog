import { useState } from "react";
import type { DxAlertRule } from "./dxAlerts";

export type AlertEntity = { adif: number; name: string };
const continents = [
  ["AF", "Africa"], ["AN", "Antarctica"], ["AS", "Asia"], ["EU", "Europe"],
  ["NA", "North America"], ["OC", "Oceania"], ["SA", "South America"],
] as const;

function EntitySelection({ ruleNumber, label, value, entities, onChange }: {
  ruleNumber: number; label: "DX" | "Spotter"; value: number[];
  entities: AlertEntity[]; onChange: (value: number[]) => void;
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLocaleLowerCase();
  const matches = needle ? entities.filter(entity =>
    !value.includes(entity.adif) &&
    (entity.name.toLocaleLowerCase().includes(needle) || String(entity.adif).includes(needle))) : [];
  const title = `Rule ${ruleNumber} ${label} entities`;
  const name = (id: number) => `${entities.find(entity => entity.adif === id)?.name ?? "DXCC entity"} (${id})`;
  return <fieldset><legend>{title}</legend>
    {value.length ? <ul aria-label={`${title} selected`}>{value.map(id => <li key={id}>
      {name(id)} <button type="button" aria-label={`Remove ${name(id)} from ${title}`}
        onClick={() => onChange(value.filter(item => item !== id))}>Remove</button>
    </li>)}</ul> : <p>Any entity</p>}
    <label>Find {label === "DX" ? "DX" : "spotter"} entity
      <input aria-label={`Rule ${ruleNumber} find ${label.toLowerCase()} entity`} value={search} maxLength={80}
        placeholder="Country name or ADIF ID" onChange={event => setSearch(event.currentTarget.value)} />
    </label>
    {needle && <div aria-label={`${title} search results`}>
      {matches.slice(0, 15).map(entity => <button type="button" key={entity.adif}
        onClick={() => onChange([...value, entity.adif])}
        aria-label={`Add ${entity.name} (${entity.adif}) to ${title}`}>{entity.name} ({entity.adif})</button>)}
      {!matches.length && <p>No unselected matching entity</p>}
      {matches.length > 15 && <p>Showing 15 matches. Refine the name or ADIF ID.</p>}
    </div>}
  </fieldset>;
}

export function AlertRuleGeography({ rule, ruleNumber, entities, onChange }: {
  rule: DxAlertRule; ruleNumber: number; entities: AlertEntity[];
  onChange: (patch: Partial<DxAlertRule>) => void;
}) {
  return <fieldset className="dx-alert-rule-geography"><legend>Rule {ruleNumber} geography</legend>
    <p>Empty fields allow any location. Filled fields must all match; choices within a field are alternatives. Missing evidence does not match a selected condition.</p>
    <EntitySelection ruleNumber={ruleNumber} label="DX" value={rule.dxEntities ?? []} entities={entities}
      onChange={dxEntities => onChange({ dxEntities })} />
    <EntitySelection ruleNumber={ruleNumber} label="Spotter" value={rule.spotterEntities ?? []} entities={entities}
      onChange={spotterEntities => onChange({ spotterEntities })} />
    {(["dxContinents", "spotterContinents"] as const).map(field => {
      const label = field === "dxContinents" ? "DX" : "spotter";
      const selected = rule[field] ?? [];
      return <fieldset key={field}><legend>Rule {ruleNumber} {label} continents</legend>
        {continents.map(([code, name]) => <label key={code}><input type="checkbox"
          aria-label={`Rule ${ruleNumber} ${label} continent ${name} (${code})`} checked={selected.includes(code)}
          onChange={event => onChange({ [field]: event.currentTarget.checked ? [...selected, code] : selected.filter(value => value !== code) })} />
          {name} ({code})</label>)}
      </fieldset>;
    })}
    {([["dxCqZones", "CQ", 40], ["dxItuZones", "ITU", 90]] as const).map(([field, label, maximum]) =>
      <div key={field}><label>Rule {ruleNumber} DX {label} zones
        <select multiple size={4} value={(rule[field] ?? []).map(String)}
          onChange={event => onChange({ [field]: Array.from(event.currentTarget.selectedOptions, option => Number(option.value)) })}>
          {Array.from({ length: maximum }, (_, index) => index + 1).map(zone => <option key={zone} value={zone}>{zone}</option>)}
        </select></label>
        <button type="button" disabled={!rule[field]?.length} onClick={() => onChange({ [field]: [] })}>
          Any {label} zone for rule {ruleNumber}
        </button>
      </div>)}
  </fieldset>;
}
