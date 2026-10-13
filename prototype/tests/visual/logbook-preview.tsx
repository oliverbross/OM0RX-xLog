// Development-only layout fixture. No IPC, credentials, radio or real contacts.
import React from "react";
import { createRoot } from "react-dom/client";
import { LogbookPanel } from "../../src/live/LogbookPanel";
import { LogbookMutationSession } from "../../src/live/logbookMutationSession";
import "../../src/style.css";
import "../../src/live/live.css";
const contacts = Array.from({ length: 501 }, (_, i) => ({
  id: `fixture-${i}`, call: i % 4 ? `TEST${i}/P` : "TEST123456789/PORTABLE", start: "2026-10-13T01:30:00Z",
  band: i % 2 ? "20m" : "160m", mode: i % 2 ? "SSB" : "CW", frequencyHz: 14250000,
  rstSent: "599", rstReceived: "579", country: "Synthetic country with a long name", name: "Example operator",
  qslSent: "Y", qslReceived: "V", lotwSent: "Y", lotwReceived: "N", extraFields: { CLUBLOG_QSO_UPLOAD_STATUS: "Y" },
  comment: "Synthetic portable contact — this deliberately long comment must remain accessible without widening the entire logbook table.",
}));
async function request(method: string, params: Record<string, unknown> = {}) {
  if (method !== "logbook_list") throw new Error("This layout fixture is read-only.");
  const found = contacts.filter(qso => !params.search || qso.call.includes(String(params.search).toUpperCase()));
  const offset = Number(params.offset ?? 0), limit = Number(params.limit ?? 20);
  return { qsos: found.slice(offset, offset + limit), total: found.length, offset, limit };
}
const mutations = new LogbookMutationSession(request, () => {});
createRoot(document.getElementById("root")!).render(<div className="app live monitor-app detached-logbook-app"><main>
  <LogbookPanel onRequest={request} mutations={mutations} onEdit={() => {}} onDock={() => {}} refreshKey={0} />
</main></div>);
