// Development-only actual-component fixture. Every read returns synthetic data;
// no native IPC, accounts, credentials, files, station or logbook mutation.
import React from "react";
import { createRoot } from "react-dom/client";
import { CallsignIntelligenceSurface } from "../../src/live/DetachedCallsignIntelligenceSurface";
import "../../src/style.css";
import "../../src/live/live.css";
const generation = "12345678-1234-1234-1234-123456789abc";
const call = "TEST123456789/PORTABLE";
const cells = [{ band: "20m", worked: true, confirmed: true }, { band: "40m", worked: true, confirmed: false }];
async function request(method: string, params: Record<string, any> = {}) {
  const unavailable = new URLSearchParams(location.search).has("unavailable");
  if (unavailable && method !== "logbook_operator_draft" && method !== "workspace_preferences_load") throw new Error("Synthetic evidence unavailable");
  if (method === "logbook_operator_draft") return { draft: { generation, revision: 4, qso: { id: "synthetic-draft", call, band: "20m", mode: "CW" } } };
  if (method === "workspace_preferences_load") return { preferences: { intelligenceBands: ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m"] } };
  if (method === "lookup_call") return { call, name: "Synthetic portable operator with a deliberately long name", country: "Synthetic country with a long name", dxcc: 504,
    source: "Synthetic CTY", gridSquare: "JN88AA", continent: "EU", cqZone: "15", ituZone: "28", latitude: 48, longitude: 17, distance_km: 12345 };
  if (method === "logbook_previous") return { qsos: [] };
  if (method === "logbook_matrix") return { cells };
  if (method === "cluster_history") return { history: { call, adif: params.adif ?? null, previous_count: 6317, previous_confirmed_count: 2782,
    previous: [{ date: "2026-01-02T01:47:00Z" }], dxcc_contact_count: 9876543, dxcc_confirmed_count: 1234567,
    last_dxcc_qso: { date: "2026-01-11T01:47:00Z" }, matrix: cells } };
  throw new Error(`Unsupported synthetic read ${method}`);
}
createRoot(document.getElementById("root")!).render(<React.StrictMode><CallsignIntelligenceSurface request={request} dock={async () => { throw new Error("Synthetic Dock unavailable"); }} /></React.StrictMode>);
