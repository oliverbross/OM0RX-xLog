import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Grip, MoveDiagonal2, RotateCcw } from "lucide-react";
import { defaultQSOCanvasLayout, moveQSOCanvasPanel, qsoCanvasHeight, qsoCanvasLayoutKey, qsoCanvasResizeEdges,
  qsoCanvasWidth, readQSOCanvasLayout, resizeQSOCanvasPanel, type QSOCanvasLayout, type QSOCanvasPanelID,
  type QSOCanvasPanelLayout, type QSOCanvasResizeEdge } from "./qsoCanvasLayout";
import "./QSOEditorCanvas.css";

export type QSOCanvasPanel = { id: QSOCanvasPanelID; title: string; content: ReactNode };
type Props = { panels: QSOCanvasPanel[]; disabled?: boolean };

function storedLayout() {
  try { return readQSOCanvasLayout(localStorage.getItem(qsoCanvasLayoutKey)); }
  catch { return defaultQSOCanvasLayout(); }
}

export default function QSOEditorCanvas({ panels, disabled = false }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(storedLayout), [arranging, setArranging] = useState(false), [compact, setCompact] = useState(false);
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    const measure = () => setCompact((root.current?.getBoundingClientRect().width ?? 0) < 940);
    measure(); if (!root.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(root.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (compact) setArranging(false); }, [compact]);
  const save = (next: QSOCanvasLayout) => {
    setLayout(next);
    try { localStorage.setItem(qsoCanvasLayoutKey, JSON.stringify(next)); setStorageError(""); }
    catch { setStorageError("Panel positions changed for this session but could not be saved."); }
  };
  const update = (panel: QSOCanvasPanelLayout) => save({ ...layout, panels: layout.panels.map(item => item.id === panel.id ? panel : item) });
  const reset = () => save(defaultQSOCanvasLayout());
  return <div className="qso-canvas-shell">
    <div className="qso-canvas-toolbar" aria-label="QSO canvas arrangement">
      <button type="button" disabled={disabled || compact} aria-pressed={arranging} onClick={() => setArranging(value => !value)}><MoveDiagonal2 size={14} aria-hidden="true" />{arranging ? "Finish arranging" : "Arrange panels"}</button>
      {arranging && <button type="button" disabled={disabled} onClick={reset}><RotateCcw size={14} aria-hidden="true" />Reset layout</button>}
      <span>{compact ? "Expand this window to arrange panels." : arranging ? "Drag a panel title to move it or drag any edge to resize. Arrow keys also work." : "Panel positions and sizes are saved on this Mac."}</span>
    </div>
    {storageError && <p className="qso-canvas-error" role="alert">{storageError}</p>}
    <div ref={root} className={`qso-canvas${arranging ? " is-arranging" : ""}${compact ? " is-compact" : ""}`} style={compact ? undefined : { aspectRatio: `${qsoCanvasWidth} / ${qsoCanvasHeight}` }}>
      {panels.map(item => {
        const panel = layout.panels.find(candidate => candidate.id === item.id)!;
        return <QSOCanvasFrame key={item.id} item={item} panel={panel} layout={layout} root={root} arranging={arranging && !compact} disabled={disabled} compact={compact} onChange={update} />;
      })}
    </div>
  </div>;
}

function QSOCanvasFrame({ item, panel, layout, root, arranging, disabled, compact, onChange }: { item: QSOCanvasPanel; panel: QSOCanvasPanelLayout; layout: QSOCanvasLayout;
  root: React.RefObject<HTMLDivElement | null>; arranging: boolean; disabled: boolean; compact: boolean; onChange: (panel: QSOCanvasPanelLayout) => void }) {
  const instructions = useId();
  const drag = useRef<{ kind: "move" | QSOCanvasResizeEdge; x: number; y: number; scaleX: number; scaleY: number } | null>(null);
  const [preview, setPreview] = useState<QSOCanvasPanelLayout | null>(null), latest = useRef<QSOCanvasPanelLayout | null>(null);
  const geometry = (preview ?? panel).rect;
  useEffect(() => { drag.current = null; latest.current = null; setPreview(null); }, [arranging, disabled, panel.id]);
  const adjust = (value: QSOCanvasPanelLayout, kind: "move" | QSOCanvasResizeEdge, dx: number, dy: number) =>
    kind === "move" ? moveQSOCanvasPanel(value, dx, dy) : resizeQSOCanvasPanel(value, kind, dx, dy);
  const show = (value: QSOCanvasPanelLayout | null) => { latest.current = value; setPreview(value); };
  const raised = (value: QSOCanvasPanelLayout) => ({ ...value, z: Math.min(10000, Math.max(...layout.panels.map(candidate => candidate.z)) + 1) });
  const commit = () => { const value = latest.current; drag.current = null; show(null); if (value && !disabled && arranging) onChange(value); };
  const cancel = () => { drag.current = null; show(null); };
  const handle = (kind: "move" | QSOCanvasResizeEdge) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || disabled || !arranging) return; event.preventDefault(); event.currentTarget.focus();
      const box = root.current?.getBoundingClientRect(); if (!box?.width || !box.height) return;
      drag.current = { kind, x: event.clientX, y: event.clientY, scaleX: qsoCanvasWidth / box.width, scaleY: qsoCanvasHeight / box.height };
      show(raised(panel)); event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      const value = drag.current; if (!value || disabled || !arranging) return;
      show(adjust(raised(panel), value.kind, (event.clientX - value.x) * value.scaleX, (event.clientY - value.y) * value.scaleY));
    },
    onPointerUp: commit, onPointerCancel: cancel, onLostPointerCapture: cancel,
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Escape") { event.preventDefault(); cancel(); return; }
      if (!arranging || disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault(); const step = event.shiftKey ? 32 : 8, current = latest.current ?? raised(panel);
      show(adjust(current, kind, event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0));
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => { if (event.key.startsWith("Arrow")) commit(); },
    onBlur: () => { if (!drag.current) commit(); },
  });
  const style: CSSProperties | undefined = compact ? undefined : { left: `${geometry.x / qsoCanvasWidth * 100}%`, top: `${geometry.y / qsoCanvasHeight * 100}%`,
    width: `${geometry.width / qsoCanvasWidth * 100}%`, height: `${geometry.height / qsoCanvasHeight * 100}%`, zIndex: (preview ?? panel).z };
  const edgeNames: Record<QSOCanvasResizeEdge, string> = { n: "top edge", ne: "top right corner", e: "right edge", se: "bottom right corner", s: "bottom edge", sw: "bottom left corner", w: "left edge", nw: "top left corner" };
  return <div className="qso-canvas-panel" style={style} aria-label={`${item.title} panel`}>
    {arranging && <div className="qso-canvas-panel-tools"><button type="button" aria-label={`Move ${item.title}`} aria-describedby={instructions} {...handle("move")}><Grip size={14} aria-hidden="true" /><span>{item.title}</span></button></div>}
    <div className="qso-canvas-panel-content">{item.content}</div>
    {arranging && <><span id={instructions} className="qso-canvas-instructions">Drag to move. Arrow keys move in 8-pixel steps; hold Shift for 32 pixels. Escape cancels.</span>{qsoCanvasResizeEdges.map(edge => <button key={edge} type="button" className={`qso-canvas-edge qso-canvas-edge-${edge}`} aria-label={`Resize ${item.title} ${edgeNames[edge]}`} aria-describedby={instructions} {...handle(edge)} />)}</>}
  </div>;
}
