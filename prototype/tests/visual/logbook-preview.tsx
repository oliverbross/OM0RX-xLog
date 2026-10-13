// Development-only interaction fixture. All edits are synthetic and memory-only;
// no IPC, credentials, radio, files or real contacts.
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { LogbookPanel } from "../../src/live/LogbookPanel";
import { LogbookMutationSession } from "../../src/live/logbookMutationSession";
import { contactEditFixture } from "../contact-edit-fixture";
import "../../src/style.css";
import "../../src/live/live.css";
const contacts = Array.from({ length: 501 }, (_, i) => ({
  id: `fixture-${i}`, call: i % 4 ? `TEST${i}/P` : "TEST123456789/PORTABLE", start: "2026-10-13T01:30:00Z",
  band: i % 2 ? "20m" : "160m", mode: i % 2 ? "SSB" : "CW", frequencyHz: 14250000,
  rstSent: "599", rstReceived: "579", country: "Synthetic country with a long name", name: "Example operator",
  qslSent: "Y", qslReceived: "V", lotwSent: "Y", lotwReceived: "N", extraFields: { CLUBLOG_QSO_UPLOAD_STATUS: "Y" },
  comment: "Synthetic portable contact — this deliberately long comment must remain accessible without widening the entire logbook table.",
}));
const backend = new Map(contacts.map(qso => [qso.id, contactEditFixture(qso)]));
const operations = new Map<string, string>();
async function request(method: string, params: Record<string, unknown> = {}) {
  if (method !== "logbook_list") {
    if (!["logbook_contact", "logbook_contact_apply", "logbook_contact_receipt"].includes(method)) throw new Error("Unsupported synthetic operation.");
    const id = String(params.contactID ?? operations.get(String(params.operationID)) ?? "");
    const fixture = backend.get(id);
    if (!fixture) throw new Error("Unknown synthetic contact.");
    if (params.operationID) operations.set(String(params.operationID), id);
    return fixture.request(method, params);
  }
  const found = contacts.filter(qso => !backend.get(qso.id)?.contact.qso.deletedAt && (!params.search || qso.call.includes(String(params.search).toUpperCase())));
  const offset = Number(params.offset ?? 0), limit = Number(params.limit ?? 20);
  return { qsos: found.slice(offset, offset + limit), total: found.length, offset, limit };
}
const mutations = new LogbookMutationSession(request, () => {});
function Preview() {
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const focus = () => { clearTimeout(timer); timer = setTimeout(() => setRefresh(value => value + 1), 120); };
    window.addEventListener("focus", focus);
    return () => { clearTimeout(timer); window.removeEventListener("focus", focus); };
  }, []);
  return <div className="app live monitor-app detached-logbook-app" data-refresh={refresh}><main>
    <LogbookPanel onRequest={request} mutations={mutations} onEdit={() => {}} onDock={() => {}} refreshKey={refresh} />
  </main></div>;
}
createRoot(document.getElementById("root")!).render(<Preview />);
