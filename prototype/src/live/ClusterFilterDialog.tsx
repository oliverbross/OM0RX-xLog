import { useId } from "react";
import { clusterFilterChoices, defaultClusterFilter, type ClusterFilter } from "./clusterFilters";
import SpecialFilterOptions from "./SpecialFilterOptions";
import "./OperatorWorkspace.css";

const filterSections: Array<[keyof Pick<ClusterFilter, "bands" | "modes" | "continents" | "spotterContinents" | "callStatuses" | "dxccStatuses" | "specials" | "sources" | "worked">, string]> = [
  ["bands", "Bands"], ["modes", "Modes"], ["continents", "DX continent"], ["spotterContinents", "Spotter continent"], ["callStatuses", "Call status"],
  ["dxccStatuses", "DXCC status"], ["specials", "Special"], ["sources", "Source"], ["worked", "Worked"],
];

export function ClusterFilterDialog({ filter, specialChoices, error = "", dialogID, contestWorked = false, onChange, onClose }: {
  filter: ClusterFilter; specialChoices: readonly string[]; error?: string;
  dialogID?: string;
  contestWorked?: boolean;
  onChange: (next: ClusterFilter) => void; onClose: () => void;
}) {
  const id = useId(), choices = { ...clusterFilterChoices, specials: specialChoices };
  return <div className="operator-filter-modal" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section id={dialogID} className="operator-filter-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
      <header><h2 id={`${id}-title`}>Cluster filters</h2><button type="button" onClick={onClose}>Done</button></header>
      {error && <p className="operator-filter-error" role="alert">{error}</p>}
      <div className="operator-filter-primary">
        <label>Search spots<input autoFocus placeholder="Callsign, country or note" value={filter.query} maxLength={128}
          onChange={event => onChange({ ...filter, query: event.target.value })} /></label>
        <label>Sort spots<select value={filter.sort} onChange={event => onChange({ ...filter, sort: event.target.value })}>
          <option value="newest">Newest</option><option value="score">Score</option><option value="frequency">Frequency</option><option value="callsign">Callsign</option>
        </select></label>
      </div>
      <div className="operator-filter-sections">{filterSections.map(([key, label]) => {
        const values = choices[key] as readonly string[], selected = filter[key];
        return <fieldset key={key} data-filter={key}><legend>{key==="worked"&&contestWorked?"Worked in this contest":label}</legend>
          {key === "specials" && values.length ? <SpecialFilterOptions filter={filter} options={values} onChange={onChange} />
            : values.length ? <div>{values.map(option => <label key={option}><input type="checkbox" checked={selected.includes(option)} onChange={event => {
              const next = event.target.checked ? [...selected, option] : selected.filter(value => value !== option);
              onChange({ ...filter, [key]: next });
            }} />{key==="worked"&&contestWorked?(option==="Worked before"?"Worked in this contest":"Not worked in this contest"):option === "rbl" ? "RBN / Skimmer" : option === "cluster" ? "DX Cluster" : option}</label>)}</div>
            : <p>No configured choices.</p>}
        </fieldset>;
      })}</div>
      <footer><button type="button" onClick={() => onChange(defaultClusterFilter())}>Clear filters</button></footer>
    </section>
  </div>;
}

export default ClusterFilterDialog;
