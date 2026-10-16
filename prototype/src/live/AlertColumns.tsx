import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { alertColumns, alertColumnsKey, defaultAlertColumns, mandatoryAlertColumn, readAlertColumns, type AlertColumnPreferences } from "./alertColumnPreferences";

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
  return <details className="dx-alert-columns"><summary>Table columns</summary>
    <div className="dx-alert-column-fields">{alertColumns.map(([column, label]) => <label key={column}>
      <input type="checkbox" aria-label={`Show ${label} column`} checked={preferences.columns.includes(column)} disabled={mandatoryAlertColumn(column)}
        onChange={event => { const checked = event.currentTarget.checked; onChange(current => ({ version: 1,
          columns: alertColumns.map(([id]) => id).filter(id => mandatoryAlertColumn(id) || (id === column ? checked : current.columns.includes(id))),
        })); }}/>{label} column
    </label>)}</div>
    <p className="secondary">Select and Call stay visible. These choices affect the wide table; compact cards retain all alert evidence.</p>
    <button type="button" onClick={() => onChange(defaultAlertColumns())}>Reset columns</button>
  </details>;
}
