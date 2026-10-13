import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { boundLogbookColumnWidth, defaultLogbookColumnPreferences, logbookColumns, logbookColumnsKey,
  minimumLogbookColumnWidth, readLogbookColumnPreferences, type LogbookColumn, type LogbookColumnContext,
  type LogbookColumnPreferences } from "./logbookColumnPreferences";

function load(context: LogbookColumnContext) {
  try { return readLogbookColumnPreferences(localStorage.getItem(logbookColumnsKey(context))); }
  catch { return defaultLogbookColumnPreferences(); }
}

export function useLogbookColumns(context: LogbookColumnContext) {
  const [stored, setStored] = useState(() => ({ context, value: load(context) }));
  // Usually separate panel instances; also protect a host which changes role.
  const value = stored.context === context ? stored.value : load(context);
  useEffect(() => {
    if (stored.context !== context) { setStored({ context, value: load(context) }); return; }
    try { localStorage.setItem(logbookColumnsKey(context), JSON.stringify(stored.value)); }
    catch { /* Storage denied/full: retain usable in-memory preferences. */ }
  }, [context, stored]);
  const setValue: Dispatch<SetStateAction<LogbookColumnPreferences>> = next => setStored(previous => {
    const current = previous.context === context ? previous.value : load(context);
    return { context, value: typeof next === "function" ? next(current) : next };
  });
  return [value, setValue] as const;
}

function WidthInput({ id, label, width, disabled, onWidth }: {
  id: LogbookColumn; label: string; width: number; disabled: boolean; onWidth: (id: LogbookColumn, width: number) => void;
}) {
  const [draft, setDraft] = useState(String(width));
  useEffect(() => setDraft(String(width)), [width]);
  function commit() {
    const parsed = draft.trim() ? Number(draft) : NaN;
    const next = Number.isFinite(parsed) ? boundLogbookColumnWidth(id, parsed) : width;
    setDraft(String(next)); onWidth(id, next);
  }
  return <input type="number" aria-label={`${label} column width`} min={minimumLogbookColumnWidth(id)} max={480}
    step={1} disabled={disabled} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />;
}

export function LogbookColumns({ id, preferences, onChange, onDone }: {
  id: string; preferences: LogbookColumnPreferences; onChange: Dispatch<SetStateAction<LogbookColumnPreferences>>; onDone: () => void;
}) {
  function width(column: LogbookColumn, value: number) {
    onChange(current => ({ ...current, widths: { ...current.widths, [column]: value } }));
  }
  return <section id={id} className="live-logbook-columns" aria-label="Logbook columns">
    <div className="live-logbook-column-fields">{logbookColumns.map(([column, label]) => {
      const shown = preferences.columns.includes(column);
      return <div key={column}>
        <label><input type="checkbox" aria-label={`Show ${label} column`} checked={shown} disabled={column === "call"}
          onChange={event => { const checked = event.target.checked; onChange(current => ({ ...current,
            columns: logbookColumns.map(([key]) => key).filter(key => key === "call" || (key === column ? checked : current.columns.includes(key))),
          })); }} />{label}</label>
        <WidthInput id={column} label={label} width={preferences.widths[column]} disabled={!shown} onWidth={width} />
      </div>;
    })}</div>
    <div className="live-logbook-column-actions"><p>Callsign stays visible. Drag column edges or use arrow keys. Minimum widths are in pixels; wider tables scroll.</p>
      <button type="button" onClick={() => onChange(defaultLogbookColumnPreferences())}>Reset columns</button>
      <button type="button" onClick={onDone}>Done</button>
    </div>
  </section>;
}

export function LogbookColumnHeader({ column, label, width, onWidth }: {
  column: LogbookColumn; label: string; width: number; onWidth: (id: LogbookColumn, width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number; scale: number } | null>(null);
  return <th scope="col" className={column === "call" ? "live-logbook-call-header" : undefined}
    title={column === "frequency" ? "Frequency in MHz" : label}>
    <span>{label}</span>
    <span className="live-logbook-column-resizer" role="separator" tabIndex={0}
      aria-label={`Resize ${label} column`} aria-orientation="vertical"
      aria-valuemin={minimumLogbookColumnWidth(column)} aria-valuemax={480} aria-valuenow={width}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
        const actual = event.currentTarget.parentElement?.getBoundingClientRect().width ?? width;
        drag.current = { x: event.clientX, width, scale: actual > 0 ? width / actual : 1 };
      }}
      onPointerMove={event => {
        if (drag.current) onWidth(column, boundLogbookColumnWidth(column,
          drag.current.width + (event.clientX - drag.current.x) * drag.current.scale));
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}
      onKeyDown={event => {
        let next: number;
        if (event.key === "ArrowLeft") next = width - 10;
        else if (event.key === "ArrowRight") next = width + 10;
        else if (event.key === "Home") next = minimumLogbookColumnWidth(column);
        else if (event.key === "End") next = 480;
        else return;
        event.preventDefault(); event.stopPropagation(); onWidth(column, boundLogbookColumnWidth(column, next));
      }} />
  </th>;
}
