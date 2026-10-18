import React from "react";
import { createRoot } from "react-dom/client";
import { loadWindowSurface } from "./windowSurface";
import { UiScaleProvider } from "./live/uiScale";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { activateMapAcceptance } from "./acceptance";
import "./surfaceStyles";
import "./live/DetachedQSOSurface.css";
import "./live/DetachedSpotHistorySurface.css";
import "./live/DetachedMapSurface.css";
import "./live/HFPropagationLive.css";
import "./live/HFPropagationCanvas.css";
import "./live/live.css";
import "./style.css";
import "maplibre-gl/dist/maplibre-gl.css";

async function mount() {
  // Normal launches do not wait for an IPC round trip. A query string alone
  // cannot enable acceptance: the native CLI gate must confirm it first.
  let acceptance = false;
  if (new URLSearchParams(location.search).get("acceptance") === "local") {
    acceptance = isTauri() && await invoke<boolean>("acceptance_enabled").catch(() => false);
    if (acceptance) activateMapAcceptance();
  }
  const root = createRoot(document.getElementById("root")!);
  let App: React.ComponentType;
  try { App = await loadWindowSurface(location.search); }
  catch {
    root.render(<div className="app live monitor-app"><main aria-label="Window unavailable"><p role="alert" className="live-error">
      This window could not load. Reload it to try again.<button onClick={() => location.reload()}>Reload window</button>
    </p></main></div>);
    return;
  }
  root.render(
    <React.StrictMode><UiScaleProvider><App /></UiScaleProvider></React.StrictMode>,
  );
  if (acceptance) void import("./integratedAcceptance").then(module => module.startIntegratedAcceptance()).catch(error => {
    const surface = new URLSearchParams(location.search).get("view");
    if (!surface) return;
    const report = {
      schema: 1, scope: "integrated-local-ui", status: "failed", embeddedUi: true, worker: false,
      checks: {}, details: { surface },
      error: `Acceptance renderer failed to start: ${error instanceof Error ? error.message : String(error)}`,
    };
    void invoke("acceptance_monitor", { report });
  });
}
void mount();
