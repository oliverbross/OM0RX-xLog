// Actual monitor component; all streams/commands injected in memory. No IPC,
// station, account, database, tile/network or hardware operations are possible.
import React from "react";
import { createRoot } from "react-dom/client";
import { MonitorSurface } from "../../src/live/DetachedMonitorSurface";
import { syntheticMonitorContext } from "../../src/live/monitorContextFixtures";
import { syntheticMapContext } from "../../src/live/mapContextFixtures";
import "../../src/surfaceStyles";
import "../../src/live/live.css";
import "../../src/style.css";
function core(changed: (value: any) => void) {
  let revision = 0;
  const refresh = () => {
    const value = syntheticMonitorContext(); value.revision = ++revision;
    value.rotor.snapshot.backend.target_label = "Synthetic TEST123456789/PORTABLE";
    if (new URLSearchParams(location.search).has("stale")) { value.radio.available = false; value.radio.received_at_ms -= 10000; }
    changed(value);
  };
  refresh(); const timer = setInterval(refresh, 1000); return { refresh, dispose: () => clearInterval(timer) };
}
function maps(changed: (value: any) => void) { const refresh = () => changed(syntheticMapContext()); refresh(); return { refresh, dispose: () => {} }; }
const target = () => ({ refresh: () => {}, dispose: () => {} });
createRoot(document.getElementById("root")!).render(<React.StrictMode><div className="synthetic-monitor-fixture" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
  <style>{".synthetic-monitor-fixture > .detached-monitor-app { height: auto; flex: 1; }"}</style>
  <p style={{ margin: 0, padding: "6px 10px", color: "#f3b23c", background: "#07111f" }}>Synthetic preview · memory-only observations and controls · no hardware</p>
  <MonitorSurface connectCore={core} connectMap={maps} connectTarget={target}
    radioAction={async () => ({ accepted: true, confirmed: false })} rotorAction={async () => ({ accepted: true, confirmed: false })}
    renderMap={() => <div style={{ width: "100%", minHeight: 180, display: "grid", placeContent: "center", color: "#92a7bf", background: "#0b1728", textAlign: "center" }}>Synthetic optional map<br />No tiles or network requested</div>} />
</div></React.StrictMode>);
