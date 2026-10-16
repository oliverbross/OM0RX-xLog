import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { alertColumns, alertColumnsKey, boundAlertColumnWidth, defaultAlertColumns, mandatoryAlertColumn, minimumAlertColumnWidth, orderedAlertColumns, readAlertColumns, type AlertColumn, type AlertColumnPreferences } from "./alertColumnPreferences";

export function useAlertColumns() {
  const [preferences, setPreferences] = useState(() => {
    try { return readAlertColumns(localStorage.getItem(alertColumnsKey)); }
    catch { return defaultAlertColumns(); }
  });
  useEffect(() => {
    try { localStorage.setItem(alertColumnsKey, JSON.stringify(preferences)); }
    catch { /* Denied/full storage leaves usable in-memory preferences. */ }
  }, [preferences]);
  return [preferences, setPreferences] as const;
}

export function AlertColumns({ preferences, onChange }: {
  preferences: AlertColumnPreferences; onChange: Dispatch<SetStateAction<AlertColumnPreferences>>;
}) {
  const ordered = orderedAlertColumns(preferences.order);
  function move(column: AlertColumn, direction: -1 | 1) {
    onChange(current => {
      const order = orderedAlertColumns(current.order).map(([id]) => id);
      const index = order.indexOf(column), target = index + direction;
      if (mandatoryAlertColumn(column) || target < 2 || target >= order.length) return current;
      [order[index], order[target]] = [order[target], order[index]];
      return { ...current, order };
    });
  }
  return <details className="dx-alert-columns"><summary>Table columns</summary>
    <div className="dx-alert-column-fields">{ordered.map(([column, label], index) => <div className="dx-alert-column-control" key={column}><label>
      <input type="checkbox" aria-label={`Show ${label} column`} checked={preferences.columns.includes(column)} disabled={mandatoryAlertColumn(column)}
        onChange={event => { const checked = event.currentTarget.checked; onChange(current => ({ ...current,
          columns: alertColumns.map(([id]) => id).filter(id => mandatoryAlertColumn(id) || (id === column ? checked : current.columns.includes(id))),
        })); }}/>{label} column
    </label>
      <AlertColumnWidth column={column} label={label} width={preferences.widths[column]} disabled={!preferences.columns.includes(column)}
        onWidth={width => onChange(current => ({ ...current, widths: { ...current.widths, [column]: width } }))}/>
      <span className="dx-alert-column-moves"><button type="button" aria-label={`Move ${label} column left`} disabled={mandatoryAlertColumn(column) || index === 2} onClick={() => move(column, -1)}>Move left</button>
        <button type="button" aria-label={`Move ${label} column right`} disabled={mandatoryAlertColumn(column) || index === ordered.length - 1} onClick={() => move(column, 1)}>Move right</button></span>
    </div>)}</div>
    <p className="secondary">Select and Call stay first and visible. Use Move left/right to order other columns. Widths are in pixels; wider tables scroll. These choices affect the wide table; compact cards retain all alert evidence.</p>
    <button type="button" onClick={() => onChange(defaultAlertColumns())}>Reset columns</button>
  </details>;
}

function AlertColumnWidth({ column, label, width, disabled, onWidth }: {
  column: AlertColumn; label: string; width: number; disabled: boolean; onWidth: (width: number) => void;
}) {
  const [draft, setDraft] = useState(String(width));
  useEffect(() => setDraft(String(width)), [width]);
  function commit() {
    const parsed = draft.trim() ? Number(draft) : NaN;
    const next = Number.isFinite(parsed) ? boundAlertColumnWidth(column, parsed) : width;
    setDraft(String(next)); onWidth(next);
  }
  return <input type="number" aria-label={`${label} column width`} min={minimumAlertColumnWidth(column)} max={480} step={1}
    value={draft} disabled={disabled} onChange={event => setDraft(event.currentTarget.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }}/>;
}
