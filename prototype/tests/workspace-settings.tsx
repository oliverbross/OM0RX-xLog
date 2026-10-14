// Development-only production-component fixture. No worker, station, or account connection.
import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import "../src/style.css";
import "../src/live/live.css";
import ServiceSettings from "../src/live/ServiceSettings";
import WorkspaceSettings from "../src/live/WorkspaceSettings";
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { nativeWorkspaceWindowIDs } from "../src/live/useWorkspaceWindows";
import { changedLayout, panelMinimum, workspacePanelIDs, WorkspaceLayoutSession, type LayoutSnapshot } from "../src/live/workspaceLayoutSession";
let snapshot: LayoutSnapshot = { revision: 0, generation: "12345678-1234-1234-1234-123456789abc", document: {
  version: 2, activePresetID: "traditional", presets: [{ id: "traditional", name: "Traditional", width: 1920, height: 800, locked: true, snap: true,
    panels: workspacePanelIDs.map((id, z) => { const [width, height] = panelMinimum(id); return { id, z, placement: "hidden", rect: { x: 0, y: 0, width, height } }; }) }],
} };
(globalThis as any).isTauri = true;
let nativeAttempt = 0;
mockIPC(async command => {
  if (command === "workspace_windows_status") return { supported: [...nativeWorkspaceWindowIDs], generation: snapshot.generation,
    revision: snapshot.revision, presetID: snapshot.document.activePresetID, state: "applied", shown: [], hidden: [], error: "", stopped: false, attempt: nativeAttempt };
  if (command === "workspace_windows_reconcile") {
    const attempt = ++nativeAttempt;
    await emit("xlog:workspace-windows");
    return { attempt };
  }
  throw new Error(`Native operation disabled in fixture: ${command}`);
}, { shouldMockEvents: true });
const session = new WorkspaceLayoutSession(async (method, params) => {
  if (method === "workspace_layout_apply") {
    if (params?.expectedRevision !== snapshot.revision) return { status: "conflict", layout: structuredClone(snapshot) };
    snapshot = { ...snapshot, revision: snapshot.revision + 1, document: changedLayout(snapshot.document, params as any) };
    await emit("xlog:workspace-windows");
  }
  return { status: "applied", layout: structuredClone(snapshot) };
});
await session.refresh();
function Fixture() {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return <div className="live" style={{ padding: 16, minHeight: "100vh" }}><p>Synthetic layout fixture · no station connection</p>
    <ServiceSettings values={{ stationCall: "TEST", gridSquare: "AA00aa" }} request={async () => { throw new Error("Service writes disabled in fixture"); }} onChanged={() => {}} onSave={async () => {}}
      workspaceSettings={<WorkspaceSettings state={state} session={session} equipment="rotor" requiredRotor available={["active-qso", "callsign-intelligence", "rotor", "world-map", "band-maps", "dx-cluster", "logbook", "awards", "spot-history"]} />} />
  </div>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
