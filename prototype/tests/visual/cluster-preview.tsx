// Development-only capability fixture. No worker, credentials or network IO.
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ClusterPanel } from "../../src/live/ClusterPanel";
import "../../src/style.css";
import "../../src/live/live.css";

const params = new URLSearchParams(location.search);
const supported = params.get("capabilities") === "mac";
const detached = params.has("detached");
const spots = detached ? Array.from({ length: 100 }, (_, index) => ({
  id: `synthetic-spot-${index}`, callsign: index % 4 ? `TEST${index}/P` : "TEST123456789/PORTABLE", frequencyKHz: 14010 + index * 3,
  band: "20m", mode: index % 2 ? "CW" : "SSB", callStatus: "New Call", dxccStatus: "Worked",
  source: "cluster", spotter: "SYNTHETIC", country: "Synthetic country", continent: "EU", grid: "JN88AA",
  receivedAt: Date.now() - index * 1_000, score: 60, specialTags: [], statusHex: "#ff8c00",
  comment: "Synthetic memory-only spot for detached table geometry; no station command or network request.",
})) : [];
const response = {
  password_storage_available: supported, flex_forwarding_available: supported,
  password_servers: [], snapshot: { connectedClusters: 0, loadedSpots: spots.length, contactCount: 0,
    contactRevision: 0, logbookDataLoaded: true, countryDataLoaded: true,
    connections: [], spots, console: [] },
  configuration: { servers: [{ id: "fixture", name: "Example DX", host: "cluster.example.invalid", port: 7300,
    callsign: "N0CALL", enabled: true }], reconnect: true, requestSkimmer: false,
    showWorkedBandModeSpots: false, maximumSpots: 100, specialRules: [],
    palette: { status: {}, band: {}, mode: {} },
    filter: { query: "", bands: [], modes: [], continents: [], callStatuses: [], dxccStatuses: [],
      specials: [], sources: ["cluster", "rbl"], worked: [], sort: "newest" },
    commandPresets: [], forwardSpotsToFlex: false },
};
const panel = <ClusterPanel passive snapshot={response} onRequest={async () => response} onSelect={() => {}} />;
const host = document.getElementById("root") as HTMLElement & { fixtureRoot?: Root };
host.fixtureRoot ??= createRoot(host);
host.fixtureRoot.render(detached
  ? <div className="app live monitor-app detached-cluster-app"><main aria-label="Synthetic detached DX Cluster">{panel}</main></div>
  : <div className="live" style={{ padding: 16 }}><p>Cluster capability fixture · synthetic data · no connection or credential access</p>{panel}</div>);
