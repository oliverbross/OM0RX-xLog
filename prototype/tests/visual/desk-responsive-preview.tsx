// Synthetic presentation only: no worker, credentials, logbook or station access.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import OperatorDesk from "../../src/live/OperatorDesk";
import "../../src/style.css";
import "../../src/live/live.css";
const noop = () => {};
const lookup = { call: "N0CALL/P", name: "Synthetic Operator", country: "United States", dxcc: 291,
  gridSquare: "FM29ik", continent: "NA", cqZone: "5", ituZone: "8", source: "Synthetic coordinates",
  latitude: 39, longitude: -75, bearing: 300, long_path_bearing: 120, distance_km: 7025 };
const request = async (method: string) => method === "logbook_duplicate" ? {}
  : method === "logbook_matrix" ? { cells: [] }
  : { history: { call: lookup.call, adif: 291, previous_count: 0, previous_confirmed_count: 0,
    previous: [], dxcc_contact_count: 9120, dxcc_confirmed_count: 7087, matrix: [] } };
function Fixture() {
  const [draft, setDraft] = useState<Record<string, any> | null>({ id: "synthetic", call: lookup.call,
    start: "2026-10-13T12:10:09Z", frequencyHz: 14287000, band: "20m", mode: "SSB", rstSent: "59", rstReceived: "59",
    name: lookup.name, country: lookup.country, gridSquare: lookup.gridSquare, county: "Cumberland", comment: "Synthetic test" });
  const equipment = new URLSearchParams(location.search).get("equipment") !== "none";
  return <main className="live" style={{ padding: 16 }}><p>Synthetic responsive desk · no device or logbook access</p>
    <OperatorDesk draft={draft} setDraft={setDraft} save={noop} clear={noop} busy={false} lookup={lookup}
      previous={[]} request={request} refresh={0} onEditor={noop} onReadRadio={async () => {}}
      follow={false} setFollow={noop} equipment={{ display: equipment ? "automatic" : "hidden" }}
      rotor={equipment ? { owner: "native_dcu1", generation: 1, state: "active", backend_available: true,
        backend: { connected: true, azimuth: 301, status: "At target · observed 301°" } } : null}
      autoRotor={false} setAutoRotor={noop} onManualRotor={noop} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
