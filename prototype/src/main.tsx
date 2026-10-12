import React from "react";
import { createRoot } from "react-dom/client";
import App from "./LiveApp";
import { UiScaleProvider } from "./live/uiScale";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { activateMapAcceptance } from "./acceptance";
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
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode><UiScaleProvider><App /></UiScaleProvider></React.StrictMode>,
  );
  if (acceptance) void import("./integratedAcceptance").then(module => module.startIntegratedAcceptance());
}
void mount();
