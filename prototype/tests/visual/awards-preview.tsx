// Synthetic, memory-only presentation fixture; no worker, equipment or credentials.
import React, { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import AwardsPanel from "../../src/live/AwardsPanel";
import "../../src/style.css";
import "../../src/live/live.css";
const stats = { awards: { qso_count: 412, dxcc_worked: 67, dxcc_confirmed: 54, cq_zones_worked: 31,
  cq_zones_confirmed: 28, states_worked: 12, states_confirmed: 9, grids_worked: 75, grids_confirmed: 50,
  mode_counts: { CW: 240, SSB: 172 }, band_counts: { "20m": 300, "40m": 112 }, continent_counts: { EU: 320, AS: 92 }, achievements: [] } };
const programmes = Array.from({ length: 20 }, (_, index) => ({ id: `fixture-${index}`, short_code: `SYN${index + 1}`,
  name: `Synthetic programme ${index + 1}`, sponsor: "Synthetic sponsor", delivery_state: "trackingOnly",
  delivery_detail: "Synthetic research record — no eligibility is asserted.", scope_or_counting_focus: "Example local evidence",
  research_sections: Array.from({ length: 6 }, (_, section) => ({ title: `Synthetic evidence section ${section + 1}`,
    text: "Review recorded confirmations before applying to the sponsor. This fixture contains no real award rules. Long research text tests that every section stays reachable in the compact details pane." })),
  open_questions: ["Synthetic final dependency remains reachable below the research sections."], official_sources: [], checked_on_utc: "2026-10-13" }));
async function request(method: string, params: Record<string, unknown> = {}) {
  if (method === "logbook_stats") return stats;
  const filtered = programmes.filter(item => item.name.toLowerCase().includes(String(params.search ?? "").toLowerCase()));
  const offset = Math.max(0, Number(params.offset) || 0), limit = Math.max(1, Number(params.limit) || 5);
  return { catalogue_total: 20, total_programmes: filtered.length, offset, limit,
    programmes: filtered.slice(offset, offset + limit), items: [], delivery_counts: { trackingOnly: 20, implemented: 0, blocked: 0, historical: 0 } };
}
function Preview() {
  const [docked, setDocked] = useState(false);
  return <div className="app live monitor-app detached-awards-app"><main aria-label="Detached Awards">
    {docked && <p role="status">Synthetic Dock action received</p>}
    <AwardsPanel request={request} refresh={0} onDock={() => setDocked(true)} />
  </main></div>;
}
const host = document.getElementById("root") as HTMLElement & { fixtureRoot?: Root };
host.fixtureRoot ??= createRoot(host);
host.fixtureRoot.render(<Preview />);
