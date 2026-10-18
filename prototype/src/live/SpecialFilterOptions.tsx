import { setSpecialFilterState, type ClusterFilter } from "./clusterFilters";

export default function SpecialFilterOptions({ filter, options, onChange }: {
  filter: ClusterFilter; options: readonly string[]; onChange: (next: ClusterFilter) => void;
}) {
  const excluded = filter.excludedSpecials ?? [];
  return <div className="special-filter-options">
    <div className="special-filter-header"><span>Station type</span><span>Show only</span><span>Hide</span></div>
    {options.map(option => <div className="special-filter-option" key={option}>
      <strong>{option}</strong>
      <label><input type="checkbox" aria-label={`Show only ${option}`} checked={filter.specials.includes(option)}
        onChange={event => onChange(setSpecialFilterState(filter, option, event.target.checked ? "include" : "neutral"))} />Yes</label>
      <label><input type="checkbox" aria-label={`Hide ${option}`} checked={excluded.includes(option)}
        onChange={event => onChange(setSpecialFilterState(filter, option, event.target.checked ? "exclude" : "neutral"))} />No</label>
    </div>)}
  </div>;
}
