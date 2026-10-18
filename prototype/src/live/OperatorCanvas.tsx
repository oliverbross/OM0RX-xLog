import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Grip, X } from "lucide-react";
import { adjustPanel, customDeskPreset, fitPanelHeight, resizeEdges, resizePanel, type ResizeEdge } from "./canvasGeometry";
import { panelMinimum, type LayoutPreset, type LayoutState, type PanelLayout, type WorkspacePanelID, type WorkspaceLayoutSession } from "./workspaceLayoutSession";
import "./OperatorCanvas.css";

export type CanvasPanel = { title: string; content: ReactNode; required?: boolean; safetyAction?: ReactNode };
type Props = { panels: Partial<Record<WorkspacePanelID, CanvasPanel>>; traditional: ReactNode; state: LayoutState;
  session: WorkspaceLayoutSession; subscriptionError?: string; equipment?: "rotor" | "antenna";
  canvasPresetMode?: "custom-only" | "all"; canChangeLayout?: () => boolean; onChangeInFlight?: (active: boolean) => void };
export default function OperatorCanvas({ panels, traditional, state, session, subscriptionError = "", equipment,
  canvasPresetMode = "custom-only", canChangeLayout, onChangeInFlight }: Props) {
  const root = useRef<HTMLDivElement>(null), toolbar = useRef<HTMLSelectElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 }), [showPanels, setShowPanels] = useState(false), [currentPanel, setCurrentPanel] = useState<WorkspacePanelID>("active-qso");
  const [error, setError] = useState(""), [working, setWorking] = useState(false);
  const active = state.snapshot?.document.presets.find(preset => preset.id === state.snapshot?.document.activePresetID);
  const custom = active && active.id !== "windowed" && (canvasPresetMode === "all" || active.id !== "traditional");
  const blocked = working || state.saving || !!state.pending || !state.snapshot;
  const performing = useRef(false);
  const perform = async (action: () => Promise<void>) => {
    if (performing.current) return;
    if (canChangeLayout?.() === false) { setError("Finish the buffered QSO fields and pending activation before changing the layout. Your text is retained."); return; }
    performing.current = true; onChangeInFlight?.(true); setWorking(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Layout change failed."); }
    finally { performing.current = false; onChangeInFlight?.(false); setWorking(false); }
  };
  useEffect(() => {
    const measure = () => { const box = root.current?.getBoundingClientRect(); if (box) setSize(current =>
      current.width === box.width && current.height === box.height ? current : { width: box.width, height: box.height }); };
    measure(); if (!root.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure); observer.observe(root.current); return () => observer.disconnect();
  }, []);
  const selectLayout = (id: string) => void perform(async () => {
    if (id === "custom" && !state.snapshot!.document.presets.some(preset => preset.id === id)) {
      const base = state.snapshot!.document.presets.find(preset => preset.id === "traditional") ?? state.snapshot!.document.presets[0];
      await session.apply({ action: "savePreset", presetID: id, preset: customDeskPreset(base, size.height, equipment) });
      if (session.getSnapshot().pending) return;
    }
    await session.apply({ action: "activatePreset", presetID: id });
  });
  const savePreset = (preset: LayoutPreset) => void perform(() => session.apply({ action: "savePreset", presetID: preset.id, preset }));
  const visible = active?.panels.filter(panel => panel.placement === "canvas" && panels[panel.id]) ?? [];
  // An owned rotor must always keep a Stop path, even if an older layout hid it.
  const compact = size.width > 0 && (size.width < 1000 || size.height < 580);
  const selected = visible.some(panel => panel.id === currentPanel) ? currentPanel : visible[0]?.id;
  const required = Object.entries(panels).filter(([id, panel]) => panel?.required && (!visible.some(item => item.id === id) || compact && selected !== id));
  const changeVisibility = (id: WorkspacePanelID, show: boolean) => {
    const panel = active!.panels.find(item => item.id === id)!;
    const [minWidth, minHeight] = panelMinimum(id);
    const width = Math.min(active!.width, Math.max(minWidth, panel.rect.width)), height = Math.min(active!.height, Math.max(minHeight, panel.rect.height));
    const rect = { x: Math.max(0, Math.min(active!.width - width, panel.rect.x)), y: Math.max(0, Math.min(active!.height - height, panel.rect.y)), width, height };
    void perform(() => session.apply({ action: "placePanel", presetID: active!.id, panel: { ...panel, placement: show ? "canvas" : "hidden",
      rect: show ? rect : panel.rect, z: Math.min(10000, Math.max(...active!.panels.map(item => item.z)) + 1) } }));
    if (show) setCurrentPanel(id);
  };
  return <div className="configurable-desk">
    <div className="canvas-toolbar" aria-label="Workspace layout">
      <label>Layout <select ref={toolbar} aria-label="Desk layout" disabled={blocked} value={active?.id ?? "traditional"} onChange={event => selectLayout(event.target.value)}>
        <option value="traditional">Traditional</option><option value="custom">{state.snapshot?.document.presets.find(preset => preset.id === "custom")?.name ?? "Custom"}</option>
        {active?.id === "windowed" && <option value="windowed" disabled>Separate Windows</option>}
        {state.snapshot?.document.presets.filter(preset => !["traditional", "custom", "windowed"].includes(preset.id)).map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select></label>
      {custom && <><button type="button" disabled={blocked} aria-pressed={!active.locked} onClick={() => savePreset({ ...active, locked: !active.locked })}>{active.locked ? "Arrange panels" : "Lock layout"}</button>
        <button type="button" disabled={blocked} aria-expanded={showPanels} onClick={() => setShowPanels(value => !value)}>Panels</button>
        {!active.locked && <label><input type="checkbox" disabled={blocked} checked={active.snap} onChange={event => savePreset({ ...active, snap: event.target.checked })} />Snap</label>}
        {compact && visible.length > 0 && <label>Panel <select aria-label="Visible desk panel" value={selected} onChange={event => setCurrentPanel(event.target.value as WorkspacePanelID)}>{visible.map(panel => <option key={panel.id} value={panel.id}>{panels[panel.id]!.title}</option>)}</select></label>}
      </>}
      <span role="status">{state.saving || working ? "Saving layout…" : !state.snapshot ? "Loading layout…" : custom && !active.locked ? compact ? "Expand the window to arrange panels." : "Drag a panel title to move it · Drag any edge or corner to resize · Arrow keys adjust the focused control" : ""}</span>
      {custom && Object.entries(panels).filter(([, panel]) => panel?.required && panel.safetyAction).map(([id, panel]) => <span className="canvas-safety-action" key={id}>{panel!.safetyAction}</span>)}
    </div>
    {(error || state.error || subscriptionError) && <div className="canvas-recovery" role="alert"><span>{error || state.error || subscriptionError}</span>
      <button type="button" disabled={working || state.saving} onClick={() => void perform(() => session.refresh())}>Reload layout</button>
      {state.pending && <><button type="button" disabled={working || state.saving || !!state.conflict || state.workspaceChanged} onClick={() => void perform(() => session.retry())}>Retry change</button>
        <button type="button" disabled={working || state.saving} onClick={() => void perform(() => session.discard())}>Use saved layout</button></>}
    </div>}
    {custom && showPanels && <fieldset className="canvas-panel-picker" disabled={blocked}><legend>Panels on this desk</legend>{Object.entries(panels).map(([id, panel]) => <label key={id}>
      <input type="checkbox" checked={visible.some(item => item.id === id) || !!panel?.required} disabled={panel?.required} onChange={event => changeVisibility(id as WorkspacePanelID, event.target.checked)} />{panel!.title}{panel?.required ? " · active device" : ""}</label>)}</fieldset>}
    <div ref={root} className={`canvas-work-area${custom ? " is-canvas" : ""}${compact ? " is-compact" : ""}`}>
      {!custom ? traditional : !visible.length ? <p className="canvas-empty">No panels shown. Choose Panels to add your working tools, or return to Traditional.</p> : visible.filter(panel => !required.some(([id]) => id === panel.id)).map(panel => <PanelFrame key={panel.id} panel={panel} preset={active} item={panels[panel.id]!} compact={compact} hidden={compact && panel.id !== selected}
        disabled={blocked} revision={`${state.snapshot!.generation}:${state.snapshot!.revision}`} onChange={value => void perform(() => session.apply({ action: "placePanel", presetID: active.id, panel: value }))}
        onHide={() => { changeVisibility(panel.id, false); toolbar.current?.focus(); }} />)}
    </div>
    {custom && required.map(([id, panel]) => <div className="canvas-required-panel" key={id}>{panel!.content}</div>)}
  </div>;
}

function PanelFrame({ panel, preset, item, compact, hidden, disabled, revision, onChange, onHide }: { panel: PanelLayout; preset: LayoutPreset; item: CanvasPanel; compact: boolean; hidden: boolean; disabled: boolean; revision: string; onChange: (value: PanelLayout) => void; onHide: () => void }) {
  const frame = useRef<HTMLDivElement>(null), drag = useRef<{ kind: "move" | ResizeEdge; x: number; y: number; scaleX: number; scaleY: number } | null>(null);
  const content = useRef<HTMLDivElement>(null), tools = useRef<HTMLDivElement>(null);
  const instructionsID = useId();
  const contentSized = panel.id === "callsign-intelligence" || panel.id === "rotor";
  const editing = !preset.locked && !compact;
  const [preview, setPreview] = useState<PanelLayout | null>(null), latest = useRef<PanelLayout | null>(null);
  const update = (value: PanelLayout | null) => { latest.current = value; setPreview(value); };
  const cancel = () => { drag.current = null; update(null); };
  useEffect(() => { cancel(); }, [revision, compact, preset.locked, disabled]);
  useEffect(() => { cancel(); }, [compact, preset.locked, preset.id]);
  const commit = () => { const value = latest.current; cancel(); if (!disabled && editing && value && JSON.stringify(value.rect) !== JSON.stringify(panel.rect)) onChange(value); };
  const geometry = (preview ?? panel).rect;
  const fitHeight = () => {
    if (disabled || !editing || drag.current || latest.current) return;
    const area = frame.current?.parentElement?.getBoundingClientRect(), body = content.current?.firstElementChild?.getBoundingClientRect();
    if (!area?.height || !body?.height) return;
    const height = body.height + (tools.current?.getBoundingClientRect().height ?? 0);
    const fitted = fitPanelHeight(panel, preset, height * preset.height / area.height);
    if (fitted.rect.height !== panel.rect.height) onChange(fitted);
  };
  const style: CSSProperties = compact ? {} : { left: `${geometry.x / preset.width * 100}%`, top: `${geometry.y / preset.height * 100}%`, width: `${geometry.width / preset.width * 100}%`, height: `${geometry.height / preset.height * 100}%`, zIndex: (preview ?? panel).z };
  const adjust = (value: PanelLayout, kind: "move" | ResizeEdge, dx: number, dy: number) =>
    kind === "move" ? adjustPanel(value, preset, "move", dx, dy) : resizePanel(value, preset, kind, dx, dy);
  const handle = (kind: "move" | ResizeEdge) => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || disabled || !editing) return; event.preventDefault(); event.currentTarget.focus();
      const box = frame.current?.parentElement?.getBoundingClientRect(); if (!box?.width || !box.height) return;
      drag.current = { kind, x: event.clientX, y: event.clientY, scaleX: preset.width / box.width, scaleY: preset.height / box.height }; event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => { const d = drag.current; if (d && editing && !disabled) update(adjust(panel, d.kind, (event.clientX - d.x) * d.scaleX, (event.clientY - d.y) * d.scaleY)); },
    onPointerUp: commit, onPointerCancel: cancel, onLostPointerCapture: cancel,
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "Escape") { event.preventDefault(); cancel(); return; }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || disabled || !editing) return;
      event.preventDefault(); const step = event.shiftKey ? 32 : 8;
      update(adjust(latest.current ?? panel, kind, event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0));
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => { if (event.key.startsWith("Arrow")) commit(); }, onBlur: () => { if (!drag.current) commit(); },
  });
  const edgeNames: Record<ResizeEdge, string> = { n: "top edge", ne: "top right corner", e: "right edge", se: "bottom right corner", s: "bottom edge", sw: "bottom left corner", w: "left edge", nw: "top left corner" };
  return <div ref={frame} className={`canvas-frame${editing ? " is-editing" : ""}`} style={style} hidden={hidden} aria-label={`${item.title} panel`}>
    {!preset.locked && !compact && <div ref={tools} className="canvas-frame-tools"><button type="button" aria-disabled={disabled} aria-label={`Move ${item.title}`} aria-describedby={instructionsID} title="Drag this title to move; arrow keys move, Shift takes a larger step, Escape cancels" {...handle("move")}><Grip size={14} /><span>{item.title}</span></button>
      {editing && contentSized && <button type="button" disabled={disabled} aria-label={`Fit height of ${item.title}`} title="Trim unused height, keeping this panel's position and width" onClick={fitHeight}>Fit height</button>}
      <button type="button" disabled={disabled || item.required} aria-label={`Hide ${item.title}`} onClick={onHide}><X size={14} /></button></div>}
    <div ref={content} className={`canvas-panel-content${contentSized ? " is-content-sized" : ""}`}>{item.content}</div>
    {!preset.locked && !compact && <span id={instructionsID} className="canvas-handle-instructions">Arrange mode. Drag the title to move or any side or corner to resize. Arrow keys adjust the focused control; Shift takes a larger step. Escape cancels a gesture. Lock layout when finished.</span>}
    {editing && resizeEdges.map(edge => <button key={edge} type="button" className={`canvas-edge canvas-edge-${edge}`} aria-disabled={disabled} aria-label={`Resize ${item.title} ${edgeNames[edge]}`} aria-describedby={instructionsID} title={`Resize ${edgeNames[edge]}; arrow keys adjust, Shift takes a larger step, Escape cancels`} {...handle(edge)} />)}
  </div>;
}
