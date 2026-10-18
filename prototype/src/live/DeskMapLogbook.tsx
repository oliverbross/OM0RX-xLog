import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { boundDeskLogbookPercent, defaultDeskMapLogbookPreferences, deskMapLogbookBounds, deskMapLogbookDividerHeight,
  deskMapLogbookKey, deskMapLogbookViews, minimumDeskLogbookHeight, minimumDeskMapHeight,
  readDeskMapLogbookPreferences, validDeskMapLogbookView, type DeskMapLogbookPreferences } from "./deskMapLogbookPreferences";
import "./DeskMapLogbook.css";

type Storage = { getItem: (key: string) => string | null; setItem: (key: string, value: string) => void };
export type DeskMapLogbookProps = { map: ReactNode; logbook: ReactNode; previousQSOs?: ReactNode; hasPreviousQSOs?: boolean;
  busy?: boolean; canChangeView?: () => boolean; storage?: Storage };
const blockedMessage = "Finish the current Logbook or editor operation before changing the Desk view.";
const storageMessage = "Desk view could not be saved. It remains available for this session.";

/** Presentation only: no draft, radio, logbook transport or new data owner. */
export function DeskMapLogbook({ map, logbook, previousQSOs, hasPreviousQSOs = false, busy = false, canChangeView, storage }: DeskMapLogbookProps) {
  const [initial] = useState(() => {
    try { return { preferences: readDeskMapLogbookPreferences((storage ?? window.localStorage).getItem(deskMapLogbookKey)), error: "" }; }
    catch { return { preferences: defaultDeskMapLogbookPreferences(), error: storageMessage }; }
  });
  const [preferences, setPreferences] = useState(initial.preferences), current = useRef(preferences); current.current = preferences;
  const [mounted, setMounted] = useState(() => ({
    map: !["logbook", "logbook-previous"].includes(initial.preferences.view),
    logbook: initial.preferences.view !== "map",
  }));
  const [storageError, setStorageError] = useState(initial.error), [denied, setDenied] = useState("");
  const [height, setHeight] = useState(0), body = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y: number; percent: number; usable: number; above: boolean } | null>(null);
  const id = useId();
  const stacked = preferences.view === "logbook-above" || preferences.view === "logbook-below";
  const previousMode = preferences.view === "logbook-previous";
  const showPrevious = previousMode && hasPreviousQSOs;
  const above = preferences.view === "logbook-above", bounds = deskMapLogbookBounds(height);
  const percent = Math.max(bounds.min, Math.min(bounds.max, preferences.logbookPercent));
  const logbookHeight = bounds.usable * percent / 100, mapHeight = bounds.usable - logbookHeight;
  useLayoutEffect(() => {
    const measure = () => setHeight(body.current?.getBoundingClientRect().height ?? 0);
    measure();
    if (typeof ResizeObserver === "undefined") { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }
    const observer = new ResizeObserver(measure); if (body.current) observer.observe(body.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (busy || !stacked) drag.current = null; }, [busy, stacked]);
  function permitted() {
    if (busy || canChangeView?.() === false) { drag.current = null; setDenied(blockedMessage); return false; }
    setDenied(""); return true;
  }
  function save(next: DeskMapLogbookPreferences) {
    current.current = next; setPreferences(next);
    try { (storage ?? window.localStorage).setItem(deskMapLogbookKey, JSON.stringify(next)); setStorageError(""); }
    catch { setStorageError(storageMessage); }
  }
  function split(value: number) {
    if (!stacked || !Number.isFinite(value) || !permitted()) return;
    save({ ...current.current, logbookPercent: boundDeskLogbookPercent(Math.max(bounds.min, Math.min(bounds.max, value))) });
  }
  const bodyStyle: CSSProperties = previousMode ? { gridTemplateRows: showPrevious ? "minmax(0, 1fr) minmax(0, 1fr)" : "minmax(0, 1fr)" }
    : stacked ? { gridTemplateRows: above
    ? `${logbookHeight}px ${deskMapLogbookDividerHeight}px ${mapHeight}px`
    : `${mapHeight}px ${deskMapLogbookDividerHeight}px ${logbookHeight}px` } : { gridTemplateRows: "minmax(0, 1fr)" };
  const fixed = bounds.min === bounds.max;
  return <section className="desk-map-logbook" aria-label="Desk map and logbook">
    <div className="desk-map-logbook-toolbar"><label htmlFor={`${id}-view`}>View</label>
      <select id={`${id}-view`} aria-label="Desk map and logbook view" value={preferences.view} disabled={busy} onChange={event => {
        const view = event.target.value; if (!validDeskMapLogbookView(view) || !permitted()) return;
        drag.current = null;
        setMounted(previous => ({ map: previous.map || !["logbook", "logbook-previous"].includes(view), logbook: previous.logbook || view !== "map" }));
        save({ ...current.current, view });
      }}>{deskMapLogbookViews.map(([view, label]) => <option key={view} value={view}>{label}</option>)}</select>
      {(denied || storageError) && <span className="desk-map-logbook-feedback" role="status">{denied || storageError}</span>}
    </div>
    <div className={`desk-map-logbook-panes${stacked ? " is-stacked" : ""}`} ref={body} style={bodyStyle}>
      <div className="desk-map-logbook-map" hidden={preferences.view === "logbook" || previousMode} inert={preferences.view === "logbook" || previousMode}
        style={{ gridRow: stacked ? above ? 3 : 1 : 1, minHeight: minimumDeskMapHeight }}>
        {mounted.map ? map : null}
      </div>
      <div className="desk-map-logbook-divider" hidden={!stacked} role="separator" aria-label="Map and Logbook height"
        aria-orientation="horizontal" aria-controls={`${id}-logbook`} aria-disabled={busy || fixed}
        tabIndex={busy || fixed ? -1 : 0} aria-valuemin={Math.round(bounds.min)} aria-valuemax={Math.round(bounds.max)}
        aria-valuenow={Math.round(percent)} aria-valuetext={`${Math.round(percent)}% Logbook`} style={{ gridRow: 2 }}
        onKeyDown={event => {
          if (busy || fixed) return;
          const step = event.shiftKey ? 10 : 2;
          const next = event.key === "Home" ? bounds.min : event.key === "End" ? bounds.max
            : event.key === "ArrowUp" ? percent + (above ? -step : step) : event.key === "ArrowDown" ? percent + (above ? step : -step) : null;
          if (next !== null) { event.preventDefault(); split(next); }
        }} onPointerDown={event => {
          if (event.button !== 0 || fixed || !permitted()) return;
          event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture?.(event.pointerId);
          drag.current = { id: event.pointerId, y: event.clientY, percent, usable: bounds.usable, above };
        }} onPointerMove={event => {
          const start = drag.current; if (!start || start.id !== event.pointerId) return;
          split(start.percent + (event.clientY - start.y) / start.usable * 100 * (start.above ? 1 : -1));
        }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />
      <div id={`${id}-logbook`} className="desk-map-logbook-logbook" hidden={preferences.view === "map"} inert={preferences.view === "map"}
        style={{ gridRow: previousMode ? showPrevious ? 2 : 1 : stacked ? above ? 1 : 3 : 1,
          minHeight: previousMode ? 0 : minimumDeskLogbookHeight }}>
        {mounted.logbook ? logbook : null}
      </div>
      <div className="desk-map-logbook-previous" hidden={!showPrevious} inert={!showPrevious} style={{ gridRow: 1 }}>
        {showPrevious ? previousQSOs : null}
      </div>
    </div>
  </section>;
}
