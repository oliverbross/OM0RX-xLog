// Development-only fixture: no worker, radio, logbook or credentials.
import React from "react";
import { createRoot } from "react-dom/client";
import { OpportunitiesPanel } from "../../src/live/OpportunitiesPanel";
import "../../src/style.css";
import "../../src/live/live.css";
const now = new Date().toISOString();
const items = Array.from({ length: 60 }, (_, index) => ({
  id: `fixture-${index}`, kind: index % 2 ? "sota" : "pota", callsign: `N${index}TEST/P`,
  reference: index % 2 ? `W1/AA-${100 + index}` : `US-${1000 + index}`,
  name: index % 2 ? "Example summit" : "Example State Park", frequency_hz: 14_074_000, mode: "FT8",
  observed_at: now, expires_at: now, source: "Synthetic preview", source_url: "", comment: "",
  reference_status: "verified", worked_count: index % 3, confirmed_count: index % 2,
  latitude: 48 + index / 10, longitude: 18 + index / 10, location_source: "fixture",
}));
const response = { generated_at: now, items, total_available: items.length, history_state: "ready",
  sources: ["pota", "sota", "wwff", "wwbota", "425dxn"].map(source => ({ source, state: "current", count: source === "pota" || source === "sota" ? 30 : 0,
    source_url: "", last_success: now, last_attempt: now, safe_error: null })), selection_tunes: false, transmit: false };
createRoot(document.getElementById("root")!).render(<div className="live" style={{ height: "100dvh", padding: 12, display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
  <OpportunitiesPanel request={async () => response} onSelect={() => {}} />
</div>);
