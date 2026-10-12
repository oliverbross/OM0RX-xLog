import React from "react";
import { createRoot } from "react-dom/client";
import App from "./LiveApp";
import { UiScaleProvider } from "./live/uiScale";
import "./style.css";
import "maplibre-gl/dist/maplibre-gl.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UiScaleProvider><App /></UiScaleProvider>
  </React.StrictMode>,
);
