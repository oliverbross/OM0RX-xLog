import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { boundHistoryColumnWidth, defaultSpotHistoryColumns, minimumHistoryColumnWidth, orderedSpotHistoryColumns, readSpotHistoryColumns,
  spotHistoryColumns, spotHistoryColumnsKey, type SpotHistoryColumn, type SpotHistoryColumnPreferences } from "./spotHistoryColumnPreferences";

export function useSpotHistoryColumns() {
  const [preferences, setPreferences] = useState(() => {
    try { return readSpotHistoryColumns(localStorage.getItem(spotHistoryColumnsKey)); }
    catch { return defaultSpotHistoryColumns(); }
  });
  useEffect(() => {
    try { localStorage.setItem(spotHistoryColumnsKey, JSON.stringify(preferences)); }
    catch { /* Denied/full storage leaves usable in-memory preferences. */ }
  }, [preferences]);
  return [preferences, setPreferences] as const;
}

function WidthInput({ column, label, width, disabled, onWidth }: {
  column: SpotHistoryColumn; label: string; width: number; disabled: boolean; onWidth: (column: SpotHistoryColumn, width: number) => void;
}) {
  const [draft, setDraft] = useState(String(width));
  useEffect(() => setDraft(String(width)), [width]);
  function commit() {
    const parsed = draft.trim() ? Number(draft) : NaN;
    const next = Number.isFinite(parsed) ? boundHistoryColumnWidth(column, parsed) : width;
    setDraft(String(next)); onWidth(column, next);
  }
  return <input type="number" aria-label={`${label} column width`} min={minimumHistoryColumnWidth(column)} max={480} step={1}
    value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />;
}

export function SpotHistoryColumns({ id, preferences, onChange, onDone }: {
  id: string; preferences: SpotHistoryColumnPreferences; onChange: Dispatch<SetStateAction<SpotHistoryColumnPreferences>>; onDone: () => void;
}) {
  function move(column: SpotHistoryColumn, direction: -1 | 1) {
    onChange(current => {
      const order = orderedSpotHistoryColumns(current).map(([key]) => key);
      const index = order.indexOf(column), target = index + direction;
      if (target < 0 || target >= order.length) return current;
      [order[index], order[target]] = [order[target], order[index]];
      return { ...current, order };
    });
  }
  const ordered = orderedSpotHistoryColumns(preferences);
  return <section id={id} className="spot-history-columns" aria-label="Spot history columns">
    <div className="spot-history-column-fields">{ordered.map(([column, label], index) => {
      const shown = preferences.columns.includes(column);
      return <div key={column}><label><input type="checkbox" aria-label={`Show ${label} column`} checked={shown} disabled={column === "call"}
        onChange={event => { const checked = event.target.checked; onChange(current => ({ ...current,
          columns: spotHistoryColumns.map(([key]) => key).filter(key => key === "call" || (key === column ? checked : current.columns.includes(key))),
        })); }} />{label}</label>
        <WidthInput column={column} label={label} width={preferences.widths[column]} disabled={!shown}
          onWidth={(key, width) => onChange(current => ({ ...current, widths: { ...current.widths, [key]: width } }))} />
        <span className="spot-history-column-order">
          <button type="button" aria-label={`Move ${label} column earlier`} disabled={index === 0} onClick={() => move(column, -1)}><ArrowLeft size={14} /></button>
          <button type="button" aria-label={`Move ${label} column later`} disabled={index === ordered.length - 1} onClick={() => move(column, 1)}><ArrowRight size={14} /></button>
        </span>
      </div>;
    })}</div>
    <div className="spot-history-column-actions"><p>Use the column arrows to change order. Callsign stays visible. Drag column edges or use arrow keys to resize. Widths are in pixels; wider tables scroll.</p>
      <button type="button" onClick={() => onChange(defaultSpotHistoryColumns())}>Reset columns</button><button type="button" onClick={onDone}>Done</button></div>
  </section>;
}

export function SpotHistoryColumnHeader({ column, label, width, onWidth }: {
  column: SpotHistoryColumn; label: string; width: number; onWidth: (column: SpotHistoryColumn, width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number; scale: number } | null>(null);
  return <th scope="col" aria-label={label}><span>{label}</span><span className="spot-history-column-resizer" role="separator" tabIndex={0}
    aria-label={`Resize ${label} column`} aria-orientation="vertical" aria-valuemin={minimumHistoryColumnWidth(column)} aria-valuemax={480} aria-valuenow={width}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId);
      const actual = event.currentTarget.parentElement?.getBoundingClientRect().width ?? width;
      drag.current = { x: event.clientX, width, scale: actual > 0 ? width / actual : 1 }; }}
    onPointerMove={event => { if (drag.current) onWidth(column, boundHistoryColumnWidth(column, drag.current.width + (event.clientX - drag.current.x) * drag.current.scale)); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onKeyDown={event => {
      const next = event.key === "Home" ? minimumHistoryColumnWidth(column) : event.key === "End" ? 480
        : event.key === "ArrowLeft" ? width - 10 : event.key === "ArrowRight" ? width + 10 : null;
      if (next === null) return; event.preventDefault(); event.stopPropagation(); onWidth(column, boundHistoryColumnWidth(column, next));
    }} /></th>;
}
