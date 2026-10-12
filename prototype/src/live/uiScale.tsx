import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { createUiScaleController, uiScaleKey, type UiScaleController, type UiScalePreference, type UiScaleState } from "./uiScaleController";

const ScaleContext = createContext<UiScaleController | null>(null);
const initial: UiScaleState = { scale: 1, requestedScale: 1, pending: false, error: "" };
const noSubscribe = () => () => {};
const initialSnapshot = () => initial;
const scaleEvent = "xlog:ui-scale";
// A single per-WebView queue also protects StrictMode/remounts from zoom reordering.
let zoomQueue = Promise.resolve();
function applyZoom(scale: number) {
  const result = zoomQueue.catch(() => {}).then(async () => {
    if (isTauri()) await getCurrentWebview().setZoom(scale);
    else document.documentElement.style.setProperty("zoom", String(scale));
    // ResizeObservers update map canvases and paginated tables after native zoom.
    window.dispatchEvent(new Event("resize"));
  });
  zoomQueue = result; return result;
}

/** Mount once at the shared React entry point, including detached/monitor windows. */
export function UiScaleProvider({ children }: { children: ReactNode }) {
  const [controller, setController] = useState<UiScaleController | null>(null);
  useEffect(() => {
    const current = createUiScaleController({ applyZoom, read: () => window.localStorage.getItem(uiScaleKey), write: value => window.localStorage.setItem(uiScaleKey, value),
      publish: async (value: UiScalePreference) => { if (isTauri()) await emit(scaleEvent, value); }, now: Date.now,
      writer: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `window-${Date.now()}-${Math.random().toString(36).slice(2)}` });
    let alive = true, unlisten: (() => void) | undefined;
    if (isTauri()) void listen(scaleEvent, event => current.accept(event.payload)).then(cleanup => { if (alive) unlisten = cleanup; else cleanup(); }).catch(() => current.reportSynchronizationFailure());
    const storage = (event: StorageEvent) => { if (event.key === uiScaleKey) current.accept(event.newValue); };
    const reset = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key === "0") { event.preventDefault(); current.setScale(1); } };
    window.addEventListener("storage", storage); window.addEventListener("keydown", reset);
    current.start(); setController(current);
    return () => { alive = false; current.dispose(); unlisten?.(); window.removeEventListener("storage", storage); window.removeEventListener("keydown", reset); };
  }, []);
  return <ScaleContext.Provider value={controller}>{children}</ScaleContext.Provider>;
}
export function useUiScale() {
  const controller = useContext(ScaleContext);
  const state = useSyncExternalStore(controller?.subscribe ?? noSubscribe, controller?.getSnapshot ?? initialSnapshot, initialSnapshot);
  return { ...state, available: !!controller, setScale: (scale: number) => controller?.setScale(scale), reset: () => controller?.setScale(1) };
}
