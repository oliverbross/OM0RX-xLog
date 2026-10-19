// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestSetupPanel, contestSetupTabs, newContestSetup, type ContestSetupDocument, type ContestSetupSession } from "./ContestSetupPanel";
afterEach(cleanup);
function props() {
  return { value: newContestSetup("OM0RX"), sessions: [{ sessionID: "session", name: "October CQ WW", pluginID: "cq_ww_cw", revision: 1, workspaceGeneration: "generation", startUTC: "2026-10-24 00:00:00" }],
    activeSessionID: "session", catalog: [{ id: "cq_ww_cw", name: "CQ WW CW" }],
    onSave: vi.fn(async (_value: ContestSetupDocument) => {}), onCreate: vi.fn(async (_value: ContestSetupDocument) => {}), onOpen: vi.fn(async (_session: ContestSetupSession) => {}), onOpenSettings: vi.fn() };
}
function open(name: string) { fireEvent.click(screen.getByRole("button", { name })); }
it("separates original File dialogs from Configuration Settings and keeps manual tab order", () => {
  const p = props(); render(<ContestSetupPanel {...p}/>);
  for (const name of ["Station Settings", "New Contest", "Choose a Contest", "Edit Current Contest", "Configuration Settings", "Edit Macros", "Edit Keys"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  expect(screen.queryByRole("tab")).toBeNull();
  open("Configuration Settings");
  expect(screen.getAllByRole("tab").map(item => item.textContent)).toEqual([...contestSetupTabs]);
  expect([...contestSetupTabs]).toEqual(["Lookup", "Sound", "CAT", "CW", "Rotator", "Cluster", "Group", "N1MM", "Bands", "Options"]);
  fireEvent.click(screen.getByRole("tab", { name: "CAT" })); open("Open xLog Radio settings");
  expect(p.onOpenSettings).toHaveBeenCalledWith("Radio");
  fireEvent.keyDown(screen.getByRole("tab", { name: "CAT" }), { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "CW" }).getAttribute("aria-selected")).toBe("true");
});
it("matches station row order, saves upstream field names, and preserves unknown existing data", async () => {
  const p = props(); p.value.station.UniqueStationField = "keep"; p.value.preferences.futureSetting = true;
  render(<ContestSetupPanel {...p}/>); open("Station Settings");
  const labels = Array.from(document.querySelectorAll(".contest-station-form label>span")).map(item => item.textContent);
  expect(labels).toEqual(["Call", "Name", "Address", "Address", "City", "State", "Zip", "Country", "Grid Square", "CQ Zone", "ITU Zone", "License", "Latitude", "Longitude", "Station TX/RX", "Power", "Antenna", "Ant. Height", "a.s.l.", "ARRL Section", "Rover QTH", "Club", "Email address"]);
  fireEvent.change(screen.getByLabelText("License"), { target: { value: "Extra" } });
  fireEvent.change(screen.getByLabelText("Station TX/RX"), { target: { value: "FLEX-8400" } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Bratislava" } });
  open("OK");
  await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce());
  expect(p.onSave.mock.calls[0][0]).toMatchObject({ station: { LicenseClass: "Extra", STXeq: "FLEX-8400", City: "Bratislava", UniqueStationField: "keep" }, preferences: { futureSetting: true } });
  expect(p.value.station.City).toBe("");
});
it("cancels isolated edits and restores the source when a dialog reopens", () => {
  const p = props(); render(<ContestSetupPanel {...p}/>); open("Station Settings");
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Unsaved" } }); open("Cancel"); open("Station Settings");
  expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("");
  expect(p.onSave).not.toHaveBeenCalled();
});
it("uses separate new and edit forms in original order, including UTC start and station category", async () => {
  const p = props(); render(<ContestSetupPanel {...p}/>); open("New Contest");
  expect(Array.from(document.querySelectorAll(".contest-parameters label>span")).map(item => item.textContent)).toEqual(["Log Type", "Start UTC", "Operator", "Band", "Power", "Mode", "Overlay", "Station", "Assisted", "Transmitter", "Sent Exchange", "Operators", "Soapbox"]);
  fireEvent.change(screen.getByLabelText("Start UTC"), { target: { value: "2026-10-24T00:00:00" } });
  fireEvent.change(screen.getByLabelText("Station"), { target: { value: "PORTABLE" } });
  open("OK");
  await waitFor(() => expect(p.onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "CQ WW CW", settings: expect.objectContaining({ StartDate: "2026-10-24 00:00:00", StationCategory: "PORTABLE" }) })));
  open("Edit Current Contest"); expect((screen.getByLabelText("Log Type") as HTMLSelectElement).disabled).toBe(true);
});
it("selects an existing contest using a name/start table and commits only with OK", async () => {
  const p = props(); render(<ContestSetupPanel {...p}/>); open("Choose a Contest");
  expect(screen.getByRole("columnheader", { name: "Contest Start" })).toBeTruthy();
  expect(screen.getByText("2026-10-24 00:00:00")).toBeTruthy();
  fireEvent.click(screen.getByText("October CQ WW")); expect(p.onOpen).not.toHaveBeenCalled();
  open("OK"); await waitFor(() => expect(p.onOpen).toHaveBeenCalledWith(p.sessions[0]));
});
it("preserves legacy N1MM endpoints while offering all four original packet rows and full bands", async () => {
  const p = props(); p.value.network.n1mmHost = "192.0.2.1"; p.value.network.n1mmContactPort = 12061;
  render(<ContestSetupPanel {...p}/>); open("Configuration Settings"); fireEvent.click(screen.getByRole("tab", { name: "N1MM" }));
  expect((screen.getByLabelText("Contact destinations") as HTMLInputElement).value).toBe("192.0.2.1:12061");
  expect(screen.getByLabelText("Send N1MM packets")).toBeTruthy(); expect(screen.getByLabelText("Score")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Radio destinations"), { target: { value: "192.0.2.2:12060 192.0.2.3:12060" } });
  fireEvent.click(screen.getByRole("tab", { name: "Bands" }));
  for (const band of ["6m", "2m", "1.25m", "70cm", "33cm", "23cm"]) expect(screen.getByLabelText(band)).toBeTruthy();
  open("Save"); await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce());
  expect(p.onSave.mock.calls[0][0].network).toMatchObject({ n1mmHost: "192.0.2.1", n1mmContactPort: 12061, n1mmRadioDestinations: "192.0.2.2:12060 192.0.2.3:12060" });
});
it("keeps ESM mappings, Call History and score reporting together in Options and networking in Group", () => {
  const p = props(); render(<ContestSetupPanel {...p}/>); open("Configuration Settings");
  fireEvent.click(screen.getByRole("tab", { name: "Options" }));
  for (const label of ["CQ", "His Call", "Exchange", "AGN", "My Call", "QRZ", "QSO B4", "Use Call History", "Use RTC score reporting", "Score reporting URL", "Score reporting username", "Score reporting password", "Score posting interval (minutes)"]) expect(screen.getByLabelText(label)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Group" }));
  for (const label of ["Connect to server", "Be the master", "Multicast Group", "Multicast Port", "Interface IP"]) expect(screen.getByLabelText(label)).toBeTruthy();
});
it("retains draft edits on failed save and prevents concurrent submissions", async () => {
  const p = props(); let reject!: (cause: Error) => void;
  p.onSave.mockImplementation(() => new Promise<void>((_, rejectPromise) => { reject = rejectPromise; }));
  render(<ContestSetupPanel {...p}/>); open("Station Settings");
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Retained" } }); open("OK");
  expect(screen.getByLabelText("City").closest("fieldset")?.disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(true);
  reject(new Error("Save failed")); await screen.findByText("Save failed");
  expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Retained");
  open("Cancel"); expect(p.onSave).toHaveBeenCalledOnce();
});
it("uses the original Edit Keys table and leaves macro-file editing explicit when no editor is connected", () => {
  const p = props(); render(<ContestSetupPanel {...p}/>); open("Edit Keys");
  expect(screen.getAllByRole("columnheader").map(item => item.textContent)).toEqual(["Context", "Key", "Action", "Description"]);
  open("Add"); expect(screen.getByLabelText("key 7")).toBeTruthy(); open("Remove"); expect(screen.queryByLabelText("key 7")).toBeNull();
  open("Cancel"); open("Edit Macros"); expect(screen.getByText(/macro file editor is not connected/)).toBeTruthy();
});
