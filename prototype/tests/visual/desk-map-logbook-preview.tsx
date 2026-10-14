// Development-only actual-component fixture. Every contact/mutation is memory
// only. No native bridge, credentials, station, sync, files or external fetch.
import React, { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DeskMapLogbook } from "../../src/live/DeskMapLogbook";
import { OperatorWorkspace } from "../../src/live/OperatorWorkspace";
import { LogbookPanel } from "../../src/live/LogbookPanel";
import { LogbookMutationSession } from "../../src/live/logbookMutationSession";
import { deskMapLogbookKey, validDeskMapLogbookView } from "../../src/live/deskMapLogbookPreferences";
import { contactEditFixture } from "../contact-edit-fixture";
import "../../src/style.css";
import "../../src/live/live.css";

const selection = new URLSearchParams(location.search).get("view");
if (validDeskMapLogbookView(selection)) localStorage.setItem(deskMapLogbookKey, JSON.stringify({ version: 1, view: selection, logbookPercent: 50 }));
const contacts = Array.from({ length: 73 }, (_, index) => ({ id: `synthetic-${index}`, call: index % 3 ? `TEST${index}/P` : "EA8/N0CALL/PORTABLE",
  start: "2026-10-14T11:20:00Z", band: "20m", mode: index % 2 ? "CW" : "SSB", frequencyHz: 14_250_000,
  rstSent: "599", rstReceived: "579", country: "Synthetic country", name: "Synthetic operator", comment: `Memory-only contact ${index + 1}`,
  qslSent: "Y", qslReceived: "N", lotwSent: "Y", lotwReceived: index % 2 ? "Y" : "N" }));
const backend = new Map(contacts.map(contact => [contact.id, contactEditFixture(contact)])), operations = new Map<string, string>();
async function request(method: string, params: Record<string, unknown> = {}) {
  if (method === "logbook_list") {
    const values = [...backend.values()].map(fixture => fixture.contact.qso).filter(contact => !contact.deletedAt
      && (!params.search || contact.call.includes(String(params.search).toUpperCase())));
    const offset = Number(params.offset ?? 0), limit = Number(params.limit ?? 20);
    return { qsos: values.slice(offset, offset + limit), total: values.length, offset, limit };
  }
  if (!["logbook_contact", "logbook_contact_apply", "logbook_contact_receipt"].includes(method)) throw new Error("Outside synthetic Logbook fixture");
  const id = String(params.contactID ?? operations.get(String(params.operationID)) ?? ""), fixture = backend.get(id);
  if (!fixture) throw new Error("Unknown synthetic contact");
  if (params.operationID) operations.set(String(params.operationID), id);
  return fixture.request(method, params);
}
const mutations = new LogbookMutationSession(request, () => {});
function MapPane() {
  const [camera, setCamera] = useState("Pacific");
  return <section aria-label="Synthetic map pane" style={{ display: "grid", alignContent: "center", justifyItems: "center", gap: 8,
    height: "100%", minHeight: 0, background: "#07111f", color: "#92a7bf", padding: 16 }}>
    <strong>Map pane · synthetic placeholder</strong><label>Retained camera <input aria-label="Synthetic map camera" value={camera} onChange={event => setCamera(event.target.value)} /></label>
  </section>;
}
function Fixture() {
  const [refresh, setRefresh] = useState(0), [working, setWorking] = useState(false), [edited, setEdited] = useState("");
  const busy = useRef(false); busy.current = working;
  return <main className="live" style={{ height: "100vh", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", gap: 6, padding: 8 }}>
    <p style={{ margin: 0, fontSize: 12, color: "#92a7bf" }}>Synthetic Desk layout · memory-only contacts · no station access{edited && ` · Edit selected: ${edited}`}</p>
    <OperatorWorkspace map={<DeskMapLogbook map={<MapPane />} busy={working} canChangeView={() => !busy.current}
      logbook={<LogbookPanel onRequest={request} mutations={mutations} refreshKey={refresh} columnContext="desk"
        onWorkingChange={setWorking} onChanged={() => setRefresh(value => value + 1)} onEdit={contact => setEdited(contact.call)} />} />}
      bandMaps={<div style={{ height: "100%", padding: 12, color: "#92a7bf" }}>Synthetic Band Maps pane · existing tools stay alongside the selected view.</div>}
      cluster={{ snapshot: { spots: [], connectedClusters: 0 } }} onSelect={() => {}} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
