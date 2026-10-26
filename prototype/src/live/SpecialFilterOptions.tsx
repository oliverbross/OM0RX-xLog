import { setSpecialShown, type ClusterFilter } from "./clusterFilters";

export default function SpecialFilterOptions({ filter, options, onChange }: {
  filter: ClusterFilter; options: readonly string[]; onChange: (next: ClusterFilter) => void;
}) {
  const excluded = filter.excludedSpecials ?? [];
  return <div className="special-filter-options">
    <p className="special-filter-help">Yes allows this type. No hides it. Other types are unaffected; band, mode and source filters still apply.</p>
    <div className="special-filter-header"><span>Station type</span><span>Show</span></div>
    {options.map(option => <div className="special-filter-option" key={option}>
      <strong>{option}</strong>
      <select aria-label={`Show ${option}`} value={excluded.includes(option) ? "no" : "yes"}
        onChange={event => onChange(setSpecialShown(filter, option, event.target.value === "yes"))}>
        <option value="yes">Yes</option><option value="no">No</option>
      </select>
    </div>)}
  </div>;
}
