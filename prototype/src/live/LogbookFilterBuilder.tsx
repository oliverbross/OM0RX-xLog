import { emptyLogbookQuery, logbookOperators, logbookQueryFields, logbookQuerySummary, type LogbookClause, type LogbookQuery } from "./logbookQuery";

export function LogbookFilterBuilder({ value, onChange, onApply, disabled }: {
  value: LogbookQuery; onChange: (value: LogbookQuery) => void; onApply: () => void; disabled?: boolean;
}) {
  function update(index: number, patch: Partial<LogbookClause>) {
    onChange({ ...value, clauses: value.clauses.map((clause, i) => i === index ? { ...clause, ...patch } : clause) });
  }
  return <fieldset className="live-logbook-filter-builder" disabled={disabled}>
    <legend>Filter contacts</legend>
    <label>Start with a preset <select value="" onChange={e => {
      const presets: Record<string, LogbookClause[]> = { cw: [{ field: "mode", op: "eq", values: ["CW"] }],
        year: [{ field: "date", op: "relative", values: ["thisYear"] }],
        lotw: [{ field: "lotw", op: "eq", values: ["N"] }] };
      if (presets[e.target.value]) onChange({ version: 1, join: "all", clauses: presets[e.target.value] });
    }}><option value="">Choose preset</option><option value="cw">CW contacts</option><option value="year">This UTC calendar year</option><option value="lotw">LoTW explicitly recorded N</option></select></label>
    <label>Conditions <select value={value.join} onChange={e => onChange({ ...value, join: e.target.value as "all" | "any" })}>
      <option value="all">Match all</option><option value="any">Match any</option>
    </select></label>
    {value.clauses.map((clause, index) => <div className="live-logbook-filter-row" key={index}>
      <label>Field <select aria-label={`Condition ${index + 1} field`} value={clause.field} onChange={e => update(index, { field: e.target.value, op: "eq", values: [""] })}>
        {logbookQueryFields.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label>Operator <select aria-label={`Condition ${index + 1} operator`} value={clause.op} onChange={e => update(index, { op: e.target.value, values: ["set", "unset"].includes(e.target.value) ? [] : e.target.value === "relative" ? ["today"] : [""] })}>
        {logbookOperators(clause.field).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      {clause.op === "relative" ? <>
        <label>UTC period <select value={clause.values[0]} onChange={e => update(index, { values: e.target.value === "lastDays" ? ["lastDays", "7"] : [e.target.value] })}>
          <option value="today">Today (UTC)</option><option value="previousDay">Previous UTC day</option><option value="thisYear">This UTC calendar year</option><option value="lastDays">Last N UTC days</option>
        </select></label>
        {clause.values[0] === "lastDays" && <label>Days <input type="number" min={1} max={3660} value={clause.values[1] ?? "7"} onChange={e => update(index, { values: ["lastDays", e.target.value] })} /></label>}
      </> : !["set", "unset"].includes(clause.op) && <>
        <label>{clause.op === "between" ? "From" : clause.op === "in" ? "Values (separate with ;)" : "Value"} <input aria-label={`Condition ${index + 1} value`} value={clause.op === "in" ? clause.values.join(";") : clause.values[0] ?? ""}
          placeholder={clause.field === "date" ? "2026-01-01T00:00:00Z" : clause.op === "in" ? "80m;160m" : ""}
          onChange={e => update(index, { values: clause.op === "in" ? e.target.value.split(";") : [e.target.value, ...clause.values.slice(1)] })} /></label>
        {clause.op === "between" && <label>Through <input value={clause.values[1] ?? ""} onChange={e => update(index, { values: [clause.values[0], e.target.value] })} /></label>}
      </>}
      <button type="button" aria-label={`Remove condition ${index + 1}`} onClick={() => onChange({ ...value, clauses: value.clauses.filter((_, i) => i !== index) })}>Remove</button>
    </div>)}
    <div className="live-logbook-filter-row">
      <button type="button" disabled={value.clauses.length >= 24} onClick={() => onChange({ ...value, clauses: [...value.clauses, { field: "stationCall", op: "eq", values: [""] }] })}>Add condition</button>
      <button type="button" onClick={onApply}>Apply conditions</button>
      <button type="button" onClick={() => onChange(emptyLogbookQuery())}>Reset conditions</button>
    </div>
    <p>{logbookQuerySummary(value)}</p>
    <p>Quick search is ANDed with these conditions. One-of values are ORed. Dates are UTC; missing values match only “is not set”, not an explicit negative or zero.</p>
  </fieldset>;
}
