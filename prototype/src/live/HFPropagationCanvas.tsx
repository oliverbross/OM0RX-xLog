import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Grip, RotateCcw } from "lucide-react";
import {
  defaultHFPropagationCanvasLayout,
  hfPropagationCanvasHeight,
  hfPropagationCanvasWidth,
  hfPropagationResizeEdges,
  moveHFPropagationPanel,
  resizeHFPropagationPanel,
  type HFPropagationCanvasLayout,
  type HFPropagationPanelID,
  type HFPropagationPanelLayout,
  type HFPropagationResizeEdge,
} from "./hfPropagationCanvasLayout";
import "./HFPropagationCanvas.css";

export type HFPropagationCanvasPanel = { id: HFPropagationPanelID; title: string; content: ReactNode };
type Props = {
  panels: HFPropagationCanvasPanel[];
  layout: HFPropagationCanvasLayout;
  arranging: boolean;
  disabled?: boolean;
  onChange: (layout: HFPropagationCanvasLayout) => void;
  onCompactChange: (compact: boolean) => void;
};

export default function HFPropagationCanvas({ panels, layout, arranging, disabled = false, onChange, onCompactChange }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const measure = () => {
      const width = root.current?.getBoundingClientRect().width ?? 0;
      const next = width > 0 && width < 960;
      setCompact(next); onCompactChange(next);
    };
    measure();
    if (!root.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(root.current); return () => observer.disconnect();
  }, [onCompactChange]);
  const update = (panel: HFPropagationPanelLayout) => onChange({ ...layout, panels: layout.panels.map(item => item.id === panel.id ? panel : item) });
  const reset = () => onChange(defaultHFPropagationCanvasLayout(layout.density));
  return <div className="hf-prop-canvas-shell">
    {arranging && !compact && <div className="hf-prop-canvas-toolbar" aria-label="HF propagation panel arrangement">
      <span>Drag a panel title to move it or drag any edge or corner to resize. Arrow keys also work.</span>
      <label>Information size<select aria-label="Information size" value={layout.density} onChange={event => onChange({ ...layout, density: event.target.value as HFPropagationCanvasLayout["density"] })}>
        <option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="large">Large</option>
      </select></label>
      <button type="button" disabled={disabled} onClick={reset}><RotateCcw size={14} aria-hidden="true" />Reset layout</button>
    </div>}
    <div ref={root} className={`hf-prop-canvas${arranging && !compact ? " is-arranging" : ""}${compact ? " is-compact" : ""}`}
      style={compact ? undefined : { aspectRatio: `${hfPropagationCanvasWidth} / ${hfPropagationCanvasHeight}` }}>
      {panels.map(item => {
        const panel = layout.panels.find(candidate => candidate.id === item.id);
        return panel ? <HFPropagationCanvasFrame key={item.id} item={item} panel={panel} layout={layout} root={root}
          arranging={arranging && !compact} disabled={disabled} compact={compact} onChange={update} /> : null;
      })}
    </div>
  </div>;
}

function HFPropagationCanvasFrame({ item, panel, layout, root, arranging, disabled, compact, onChange }: {
  item: HFPropagationCanvasPanel;
  panel: HFPropagationPanelLayout;
  layout: HFPropagationCanvasLayout;
  root: React.RefObject<HTMLDivElement | null>;
  arranging: boolean;
  disabled: boolean;
  compact: boolean;
  onChange: (panel: HFPropagationPanelLayout) => void;
}) {
  const instructions = useId();
  const drag = useRef<{ kind: "move" | HFPropagationResizeEdge; x: number; y: number; scaleX: number; scaleY: number } | null>(null);
  const [preview, setPreview] = useState<HFPropagationPanelLayout | null>(null), latest = useRef<HFPropagationPanelLayout | null>(null);
  const geometry = (preview ?? panel).rect;
  useEffect(() => { drag.current = null; latest.current = null; setPreview(null); }, [arranging, disabled, panel.id]);
  const adjust = (value: HFPropagationPanelLayout, kind: "move" | HFPropagationResizeEdge, dx: number, dy: number) =>
    kind === "move" ? moveHFPropagationPanel(value, dx, dy) : resizeHFPropagationPanel(value, kind, dx, dy);
  const show = (value: HFPropagationPanelLayout | null) => { latest.current = value; setPreview(value); };
  const raised = (value: HFPropagationPanelLayout) => ({ ...value, z: Math.min(10_000, Math.max(...layout.panels.map(candidate => candidate.z)) + 1) });
  const commit = () => { const value = latest.current; drag.current = null; show(null); if (value && !disabled && arranging) onChange(value); };
  const cancel = () => { drag.current = null; show(null); };
  const handle = (kind: "move" | HFPropagationResizeEdge) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || disabled || !arranging) return;
      event.preventDefault(); event.currentTarget.focus();
      const box = root.current?.getBoundingClientRect(); if (!box?.width || !box.height) return;
      drag.current = { kind, x: event.clientX, y: event.clientY, scaleX: hfPropagationCanvasWidth / box.width, scaleY: hfPropagationCanvasHeight / box.height };
      show(raised(panel)); event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      const value = drag.current; if (!value || disabled || !arranging) return;
      show(adjust(raised(panel), value.kind, (event.clientX - value.x) * value.scaleX, (event.clientY - value.y) * value.scaleY));
    },
    onPointerUp: commit,
    onPointerCancel: cancel,
    onLostPointerCapture: cancel,
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Escape") { event.preventDefault(); cancel(); return; }
      if (!arranging || disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const step = event.shiftKey ? 32 : 8, current = latest.current ?? raised(panel);
      show(adjust(current, kind, event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0,
        event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0));
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => { if (event.key.startsWith("Arrow")) commit(); },
    onBlur: () => { if (!drag.current) commit(); },
  });
  const style: CSSProperties | undefined = compact ? undefined : {
    left: `${geometry.x / hfPropagationCanvasWidth * 100}%`, top: `${geometry.y / hfPropagationCanvasHeight * 100}%`,
    width: `${geometry.width / hfPropagationCanvasWidth * 100}%`, height: `${geometry.height / hfPropagationCanvasHeight * 100}%`, zIndex: (preview ?? panel).z,
  };
  const edgeNames: Record<HFPropagationResizeEdge, string> = {
    n: "top edge", ne: "top right corner", e: "right edge", se: "bottom right corner",
    s: "bottom edge", sw: "bottom left corner", w: "left edge", nw: "top left corner",
  };
  return <div className="hf-prop-canvas-panel" style={style} aria-label={`${item.title} panel`}>
    {arranging && <div className="hf-prop-canvas-panel-tools"><button type="button" aria-label={`Move ${item.title}`} aria-describedby={instructions} {...handle("move")}><Grip size={14} aria-hidden="true" /><span>{item.title}</span></button></div>}
    <div className="hf-prop-canvas-panel-content">{item.content}</div>
    {arranging && <><span id={instructions} className="hf-prop-canvas-instructions">Drag to move. Arrow keys move in 8-pixel steps; hold Shift for 32 pixels. Escape cancels.</span>
      {hfPropagationResizeEdges.map(edge => <button key={edge} type="button" className={`hf-prop-canvas-edge hf-prop-canvas-edge-${edge}`}
        aria-label={`Resize ${item.title} ${edgeNames[edge]}`} aria-describedby={instructions} {...handle(edge)} />)}</>}
  </div>;
}
