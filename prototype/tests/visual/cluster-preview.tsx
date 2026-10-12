// Development-only capability fixture. No worker, credentials or network IO.
import React from "react";
import { createRoot } from "react-dom/client";
import { ClusterPanel } from "../../src/live/ClusterPanel";
import "../../src/style.css";
import "../../src/live/live.css";

const supported = new URLSearchParams(location.search).get("capabilities") === "mac";
const response = {
  password_storage_available: supported, flex_forwarding_available: supported,
  password_servers: [], snapshot: { connectedClusters: 0, loadedSpots: 0, contactCount: 0,
    contactRevision: 0, logbookDataLoaded: true, countryDataLoaded: true,
    connections: [], spots: [], console: [] },
  configuration: { servers: [{ id: "fixture", name: "Example DX", host: "cluster.example.invalid", port: 7300,
    callsign: "N0CALL", enabled: true }], reconnect: true, requestSkimmer: false,
    showWorkedBandModeSpots: false, maximumSpots: 100, specialRules: [],
    palette: { status: {}, band: {}, mode: {} },
    filter: { query: "", bands: [], modes: [], continents: [], callStatuses: [], dxccStatuses: [],
      specials: [], sources: ["cluster", "rbl"], worked: [], sort: "newest" },
    commandPresets: [], forwardSpotsToFlex: false },
};
createRoot(document.getElementById("root")!).render(<div className="live" style={{ padding: 16 }}>
  <p>Cluster capability fixture · synthetic data · no connection or credential access</p>
  <ClusterPanel passive snapshot={response} onRequest={async () => response} onSelect={() => {}} />
</div>);
