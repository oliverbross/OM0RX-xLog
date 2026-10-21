// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestSetupPanel, contestSetupTabs, loadContestAudioOutputs, newContestSetup, restoredESMPreferences, type ContestSetupDocument, type ContestSetupSession } from "./ContestSetupPanel";
afterEach(() => { cleanup(); vi.useRealTimers(); document.documentElement.style.removeProperty("zoom"); });
function props() {
  return { value: newContestSetup("OM0RX"), sessions: [{ sessionID: "session", name: "October CQ WW", pluginID: "cq_ww_cw", revision: 1, workspaceGeneration: "generation", startUTC: "2026-10-24 00:00:00" }],
    activeSessionID: "session", catalog: [{ id: "cq_ww_cw", name: "CQ WW CW", modes: ["CW"], sentExchangeHint: "Sent Exchange", overlayChoices: ["N/A", "CLASSIC", "ROOKIE", "TB-WIRES", "YOUTH"] }],
    onSave: vi.fn(async (_value: ContestSetupDocument) => {}), onCreate: vi.fn(async (_value: ContestSetupDocument) => {}), onOpen: vi.fn(async (_session: ContestSetupSession) => {}), onOpenSettings: vi.fn() };
}
function open(name: string) { fireEvent.click(screen.getByRole("button", { name })); }
it("uses upstream ESM defaults for new contests and explicit compatibility defaults only for missing saved fields", () => {
  const preferences = newContestSetup("OM0RX").preferences;
  expect(newContestSetup("OM0RX").settings.SentExchange).toBe("");
  expect(newContestSetup("OM0RX").settings.OverlayCategory).toBe("N/A");
  expect(preferences.useESM).toBe(false);
  expect(preferences.sendCorrectedCall).toBe(false);
  for (const key of ["esmCQ", "esmHisCall", "esmExchange", "esmAGN", "esmMyCall", "esmQRZ", "esmQsoB4"]) expect(preferences[key]).toBe("DISABLED");
  expect(restoredESMPreferences({})).toMatchObject({ useESM: true, sendCorrectedCall: true, esmCQ: "F1", esmExchange: "F3", esmAGN: "F9" });
  expect(restoredESMPreferences(preferences)).toEqual(preferences);
  expect(restoredESMPreferences({ useESM: false, esmCQ: "F12" })).toMatchObject({ useESM: false, esmCQ: "F12", esmExchange: "F3" });
});
it("separates original File dialogs from Configuration Settings and keeps manual tab order", () => {
  const p = props(); render(<ContestSetupPanel {...p}/>);
  for (const name of ["Station Settings", "New Contest", "Choose a Contest", "Edit Current Contest", "Configuration Settings", "Edit Macros", "Edit Keys"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  expect(screen.queryByRole("tab")).toBeNull();
  open("Configuration Settings");
  expect(screen.getAllByRole("tab").map(item => item.textContent)).toEqual([...contestSetupTabs]);
  expect([...contestSetupTabs]).toEqual(["Lookup", "Sound", "CAT", "CW", "Rotator", "Cluster", "Group", "N1MM", "Bands", "Options"]);
  expect(screen.getByRole("tablist").style.getPropertyValue("--contest-setup-tab-count")).toBe(String(contestSetupTabs.length));
  fireEvent.click(screen.getByRole("tab", { name: "CAT" })); open("Open xLog Radio settings");
  expect(p.onOpenSettings).toHaveBeenCalledWith("Radio");
  fireEvent.keyDown(screen.getByRole("tab", { name: "CAT" }), { key: "ArrowRight" });
  expect(screen.getByRole("tab", { name: "CW" }).getAttribute("aria-selected")).toBe("true");
});
it("opens Edit Macros as a separate native dialog when Contest Setup owns window routing", async () => {
  const p = props(), onOpenDialog = vi.fn();
  render(<ContestSetupPanel {...p} onOpenDialog={onOpenDialog}/>);
  open("Edit Macros");
  await waitFor(() => expect(onOpenDialog).toHaveBeenCalledExactlyOnceWith("macros"));
  expect(screen.queryByLabelText("Run F1 template")).toBeNull();
});
it("opens Edit Keys as a separate native dialog while preserving the in-Setup editor", async () => {
  const p = props(), onOpenDialog = vi.fn();
  const view = render(<ContestSetupPanel {...p} onOpenDialog={onOpenDialog}/>);
  open("Edit Keys");
  await waitFor(() => expect(onOpenDialog).toHaveBeenCalledExactlyOnceWith("keys"));
  expect(screen.queryByLabelText("key 1")).toBeNull();
  view.rerender(<ContestSetupPanel {...p}/>);
  open("Edit Keys");
  expect(screen.getByLabelText("key 1")).toBeTruthy();
});
it("matches station row order, saves upstream field names, and preserves unknown existing data", async () => {
  const p = props(); p.value.station.UniqueStationField = "keep"; p.value.preferences.futureSetting = true;
  render(<ContestSetupPanel {...p}/>); open("Station Settings");
  const labels = Array.from(document.querySelectorAll(".contest-station-form label>span")).map(item => item.textContent);
  expect(labels).toEqual(["Call", "Name", "Address", "Address", "City", "State", "Zip", "Country", "Grid Square", "CQ Zone", "ITU Zone", "License", "Latitude", "Longitude", "Station TX/RX", "Power", "Antenna", "Ant. Height", "a.s.l.", "ARRL Section", "Rover QTH", "Club", "Email address"]);
  expect(screen.getByText("Station TX/RX", { selector: ".contest-setup-field>span" }).getAttribute("title")).toBe("Station TX/RX");
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
  const p = props(); p.value.settings.SentExchange = "ACCEPTANCE TEST"; render(<ContestSetupPanel {...p}/>); open("New Contest");
  expect(screen.getByRole("region", { name: "Contest Setup" }).getAttribute("data-setup-view")).toBe("New Contest");
  expect(Array.from(document.querySelectorAll(".contest-parameters label>span")).map(item => item.textContent)).toEqual(["Log Type", "Start UTC", "Operator", "Band", "Power", "Mode", "Overlay", "Station", "Assisted", "Transmitter", "Sent Exchange", "Operators", "Soapbox"]);
  expect((screen.getByLabelText("Sent Exchange") as HTMLInputElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("Start UTC"), { target: { value: "2026-10-24T00:00:00" } });
  fireEvent.change(screen.getByLabelText("Station"), { target: { value: "PORTABLE" } });
  open("OK");
  await waitFor(() => expect(p.onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "CQ WW CW", settings: expect.objectContaining({ StartDate: "2026-10-24 00:00:00", StationCategory: "PORTABLE" }) })));
  open("Edit Current Contest"); expect((screen.getByLabelText("Log Type") as HTMLSelectElement).disabled).toBe(true);
});
it("populates a new contest with the actual current UTC start instead of a visual-only date placeholder", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T09:41:02Z"));
  const p = props();
  render(<ContestSetupPanel {...p}/>); open("New Contest");
  expect((screen.getByLabelText("Start UTC") as HTMLInputElement).value).toBe("2026-10-21T09:41:02.000");
});
it("clears the CQ WW exchange and asks for the operator name when ICWC is selected", async () => {
  const p = props(); p.catalog.push({ id: "icwc_mst", name: "ICWC Medium Speed Test", modes: ["CW"],
    sentExchangeHint: "Name", overlayChoices: ["N/A", "CLASSIC", "ROOKIE", "TB-WIRES", "YOUTH"] });
  render(<ContestSetupPanel {...p}/>); open("New Contest");
  fireEvent.change(screen.getByLabelText("Log Type"), { target: { value: "icwc_mst" } });
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  expect(screen.queryByLabelText("Sent Exchange")).toBeNull();
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "OLIVER" } }); open("OK");
  await waitFor(() => expect(p.onCreate).toHaveBeenCalledWith(expect.objectContaining({ pluginID: "icwc_mst", name: "ICWC Medium Speed Test", settings: expect.objectContaining({ SentExchange: "OLIVER" }) })));
});
it("uses Sweepstakes metadata to lock CW, omit unsupported overlays and label the exchange", () => {
  const p = props(); p.catalog.push({ id: "arrl_ss_cw", name: "ARRL Sweepstakes CW", modes: ["CW"],
    sentExchangeHint: "Prec Call Check Section", overlayChoices: ["N/A"] });
  render(<ContestSetupPanel {...p}/>); open("New Contest");
  fireEvent.change(screen.getByLabelText("Log Type"), { target: { value: "arrl_ss_cw" } });
  const mode = screen.getByLabelText("Mode") as HTMLSelectElement;
  expect(mode.value).toBe("CW"); expect(mode.disabled).toBe(true);
  expect(Array.from((screen.getByLabelText("Overlay") as HTMLSelectElement).options).map(option => option.value)).toEqual(["N/A"]);
  expect(screen.getByLabelText("Prec Call Check Section")).toBeTruthy();
});
it("offers the MIXED Cabrillo category when a plugin supports both CW and SSB", () => {
  const p = props(); p.catalog.push({ id: "euhfc", name: "EUHFC", modes: ["CW", "SSB"], sentExchangeHint: "Lic. Year (2 digits)", overlayChoices: ["N/A"] });
  render(<ContestSetupPanel {...p}/>); open("New Contest");
  fireEvent.change(screen.getByLabelText("Log Type"), { target: { value: "euhfc" } });
  const mode = screen.getByLabelText("Mode") as HTMLSelectElement;
  expect(Array.from(mode.options).map(option => option.value)).toEqual(["CW", "SSB", "MIXED"]);
  fireEvent.change(mode, { target: { value: "MIXED" } });
  open("OK");
  expect(p.onCreate).toHaveBeenCalledWith(expect.objectContaining({ pluginID: "euhfc", settings: expect.objectContaining({ ModeCategory: "MIXED" }) }));
});
it("selects an existing contest using a name/start table and commits only with OK", async () => {
  const p = props(); render(<ContestSetupPanel {...p}/>); open("Choose a Contest");
  expect(screen.getByRole("columnheader", { name: "Contest Start" })).toBeTruthy();
  expect(screen.getByText("2026-10-24 00:00:00")).toBeTruthy();
  fireEvent.click(screen.getByText("October CQ WW")); expect(p.onOpen).not.toHaveBeenCalled();
  open("OK"); await waitFor(() => expect(p.onOpen).toHaveBeenCalledWith(p.sessions[0]));
});
it("edits the original N1MM packet controls and derives destinations from legacy host and ports", async () => {
  const p = props();
  Object.assign(p.value.network, { n1mmHost: "192.0.2.1", n1mmRadioPort: 12060, n1mmContactPort: 12061, n1mmLookupPort: 12062 });
  render(<ContestSetupPanel {...p}/>); open("Configuration Settings");
  fireEvent.click(screen.getByRole("tab", { name: "N1MM" }));
  expect((screen.getByLabelText("Radio destinations") as HTMLInputElement).value).toBe("192.0.2.1:12060");
  expect((screen.getByLabelText("Contact destinations") as HTMLInputElement).value).toBe("192.0.2.1:12061");
  expect((screen.getByLabelText("Lookup destinations") as HTMLInputElement).value).toBe("192.0.2.1:12062");
  expect((screen.getByLabelText("Score destinations") as HTMLInputElement).value).toBe("192.0.2.1:12060");
  fireEvent.click(screen.getByLabelText("Send N1MM packets"));
  fireEvent.click(screen.getByLabelText("Radio"));
  fireEvent.change(screen.getByLabelText("Station Name"), { target: { value: "RUN" } });
  fireEvent.change(screen.getByLabelText("Operator Name"), { target: { value: "OM0RX" } });
  fireEvent.change(screen.getByLabelText("Radio destinations"), { target: { value: "127.0.0.1:12060 192.0.2.255:12060" } });
  fireEvent.click(screen.getByRole("tab", { name: "Bands" }));
  for (const band of ["6m", "2m", "1.25m", "70cm", "33cm", "23cm"]) expect(screen.getByLabelText(band)).toBeTruthy();
  open("Save"); await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce());
  expect(p.onSave.mock.calls[0][0].network).toMatchObject({
    n1mmHost: "192.0.2.1", n1mmContactPort: 12061, n1mmEnabled: true, n1mmRadio: true,
    n1mmStationName: "RUN", n1mmOperatorName: "OM0RX",
    n1mmRadioDestinations: "127.0.0.1:12060 192.0.2.255:12060", n1mmContactDestinations: "192.0.2.1:12061",
  });
});
it("uses the selected plugin's complete advertised band choices", () => {
  const p = props(), supportedBands = ["6m", "2m", "1.25m", "13cm", "2mm"];
  (p.catalog[0] as typeof p.catalog[0] & { supportedBands: string[] }).supportedBands = supportedBands;
  render(<ContestSetupPanel {...p}/>); open("Configuration Settings"); fireEvent.click(screen.getByRole("tab", { name: "Bands" }));
  for (const band of supportedBands) expect(screen.getByLabelText(band)).toBeTruthy();
  expect(screen.queryByLabelText("20m")).toBeNull();
});
it("shows the bounded Renfield capabilities and pinned multicast default", () => {
  const p = props(); render(<ContestSetupPanel {...p}/>); open("Configuration Settings");
  fireEvent.click(screen.getByRole("tab", { name: "Options" }));
  for (const label of ["CQ", "His Call", "Exchange", "AGN", "My Call", "QRZ", "QSO B4", "Auto CQ Delay (Seconds)", "Use Call History"]) expect(screen.getByLabelText(label)).toBeTruthy();
  expect(screen.queryByLabelText("Use RTC score reporting")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Group" }));
  for (const label of ["Enable Renfield Group Network", "Be the master", "Unique Station Name", "Multicast Group", "Multicast Port", "Interface IP"]) expect(screen.getByLabelText(label)).toBeTruthy();
  expect((screen.getByLabelText("Multicast Group") as HTMLInputElement).value).toBe("239.1.1.1");
  expect(screen.queryByLabelText("Connect to server")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("isolated trusted LAN");
  expect(screen.getByRole("status").textContent).toContain("not peer-authenticated");
  expect(screen.getByRole("status").textContent).toContain("Legacy acknowledgements remain transport-only");
});
it("migrates the obsolete multicast default and exposes saved master state", async () => {
  const p = props(); p.value.network.multicastGroup = "224.1.1.1"; p.value.network.multiMaster = true;
  render(<ContestSetupPanel {...p} initialTab="Group"/>);
  expect((screen.getByLabelText("Multicast Group") as HTMLInputElement).value).toBe("239.1.1.1");
  expect((screen.getByLabelText("Be the master") as HTMLInputElement).checked).toBe(true);
  open("Save"); await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce());
  expect(p.onSave.mock.calls[0][0].network).toMatchObject({ multicastGroup: "239.1.1.1", multiMaster: true });
});
it("rejects an unsafe Auto CQ delay before saving", async () => {
  const p=props();render(<ContestSetupPanel {...p}/>);open("Configuration Settings");
  fireEvent.click(screen.getByRole("tab",{name:"Options"}));
  fireEvent.change(screen.getByLabelText("Auto CQ Delay (Seconds)"),{target:{value:"0"}});open("Save");
  expect(await screen.findByText("Auto CQ Delay must be between 1 and 3600 seconds.")).toBeTruthy();
  expect(p.onSave).not.toHaveBeenCalled();
});
it.each([false, true])("keeps every available detached Options control inside the two-column body with an embedded history panel=%s", async embedded => {
  const p = props(), onOpenCallHistory = vi.fn();
  p.value.preferences.rtcIntervalMinutes = 3; p.value.preferences.clearOnVFOChange = true;
  render(<ContestSetupPanel {...p} initialTab="Options" detachedDialog="configuration" onOpenCallHistory={onOpenCallHistory}
    callHistoryPanel={embedded ? <section aria-label="Call history manager"><button type="button">Import local file</button></section> : undefined}/>);
  const panel = screen.getByRole("tabpanel"), columns = panel.querySelector(".contest-options-columns");
  expect(Array.from(panel.children)).toEqual([columns]);
  expect(columns?.children.length).toBe(2);
  const left = columns!.children[0], right = columns!.children[1];
  expect(left.className).toBe("contest-manual-stack");
  expect(right.className).toBe("contest-manual-stack");
  expect(left.contains(screen.getByLabelText("Enable ESM"))).toBe(true);
  for (const label of ["Auto CQ Delay (Seconds)", "Use Call History", "Clear input fields in S&P when the VFO frequency changes"]) {
    expect(right.contains(screen.getByLabelText(label))).toBe(true);
  }
  expect(screen.queryByLabelText("Use RTC score reporting")).toBeNull();
  expect((screen.getByLabelText("Clear input fields in S&P when the VFO frequency changes") as HTMLInputElement).checked).toBe(true);
  const historyControl = screen.getByRole("button", { name: embedded ? "Import local file" : "Open Call History" });
  expect(right.contains(historyControl)).toBe(true);
  const footer = screen.getByRole("button", { name: "Save" }).closest("footer")!;
  expect(panel.closest("fieldset")?.nextElementSibling).toBe(footer);
  if (!embedded) { fireEvent.click(historyControl); expect(onOpenCallHistory).toHaveBeenCalledOnce(); }
  else expect(screen.queryByRole("button", { name: "Open Call History" })).toBeNull();
  open("Save");
  await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce());
  expect(p.onSave.mock.calls[0][0].preferences).toMatchObject({ clearOnVFOChange: true, rtcIntervalMinutes: 3 });
});
it("uses the Not1MM Sound tab to choose and durably save the voice-keyer output", async () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { enumerateDevices: vi.fn(async () => [
    { kind: "audioinput", deviceId: "mic", label: "Desk microphone" },
    { kind: "audiooutput", deviceId: "radio", label: "Radio line out" },
    { kind: "audiooutput", deviceId: "headphones", label: "Operator headphones" },
  ]) } });
  try {
    const p = props(); render(<ContestSetupPanel {...p}/>); open("Configuration Settings"); fireEvent.click(screen.getByRole("tab", { name: "Sound" }));
    const output = await screen.findByLabelText("Sound Output") as HTMLSelectElement;
    const profile = screen.getByLabelText("Voice WAV profile folder") as HTMLInputElement;
    await waitFor(() => expect(Array.from(output.options).map(option => option.textContent)).toEqual(["System default", "Radio line out", "Operator headphones"]));
    fireEvent.change(output, { target: { value: "headphones" } }); fireEvent.change(profile, { target: { value: "/Users/operator/voice" } }); open("Save");
    await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce());
    expect(p.onSave.mock.calls[0][0].preferences.soundDevice).toBe("headphones");
    expect(p.onSave.mock.calls[0][0].preferences.voiceProfilePath).toBe("/Users/operator/voice");
  } finally {
    if (original) Object.defineProperty(navigator, "mediaDevices", original); else Reflect.deleteProperty(navigator, "mediaDevices");
  }
});
it("filters contest audio discovery to uniquely identified output devices", async () => {
  const enumerate = vi.fn(async () => [
    { kind: "audiooutput", deviceId: "radio", label: "" },
    { kind: "audiooutput", deviceId: "radio", label: "Duplicate" },
    { kind: "videoinput", deviceId: "camera", label: "Camera" },
  ] as MediaDeviceInfo[]);
  await expect(loadContestAudioOutputs(enumerate)).resolves.toEqual([{ deviceID: "radio", label: "Audio output 1" }]);
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
it("uses the original Edit Keys table and saves key changes", async () => {
  const p = props(); render(<ContestSetupPanel {...p}/>); open("Edit Keys");
  expect(screen.getAllByRole("columnheader").map(item => item.textContent)).toEqual(["Context", "Key", "Action", "Description"]);
  expect(document.querySelector(".contest-binding-table")).toBeTruthy();
  expect(screen.getByLabelText("description 1").getAttribute("title")).toBe(screen.getByLabelText("description 1").textContent);
  expect(Array.from((screen.getByLabelText("action 1") as HTMLSelectElement).options).map(option => option.value)).toEqual(expect.arrayContaining([
      "SET_RUN", "SET_S_AND_P", "FOCUS_CALLSIGN", "FOCUS_NEXT", "FOCUS_PREVIOUS", "CW_SPEED_UP", "CW_SPEED_DOWN", "SPOT_DX", "MARK_SPOT", "TUNE_SPOT", "SEND_F1", "SEND_F12",
  ]));
  expect(Array.from((screen.getByLabelText("action 1") as HTMLSelectElement).options).map(option => option.value)).not.toEqual(expect.arrayContaining([
      "VFO_UP", "ROTATE",
  ]));
  const initialRows=screen.getAllByLabelText(/^key \d+$/).length;
  open("Add");const addedKey=screen.getByLabelText(`key ${initialRows+1}`);expect(addedKey).toBeTruthy();
  fireEvent.click(addedKey);open("Remove");expect(screen.queryByLabelText(`key ${initialRows+1}`)).toBeNull();
  fireEvent.change(screen.getByLabelText("key 1"), { target: { value: "Alt+R" } }); open("OK");
  await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce());
  expect(JSON.parse(String(p.onSave.mock.calls[0][0].preferences.keyBindings))[0]).toEqual(["*", "Alt+R", "TOGGLE_RUN"]);
});
it.each([100, 125, 150, 175, 200])("keeps all Edit Keys columns available at %i%% interface scale", scale => {
  document.documentElement.style.zoom = `${scale}%`;
  render(<ContestSetupPanel {...props()}/>); open("Edit Keys");
  expect(screen.getAllByRole("columnheader").map(item => item.textContent)).toEqual(["Context", "Key", "Action", "Description"]);
  expect(screen.getByLabelText("context 1")).toBeTruthy();
  expect(screen.getByLabelText("key 1")).toBeTruthy();
  expect(screen.getByLabelText("action 1")).toBeTruthy();
  expect(screen.getByLabelText("description 1")).toBeTruthy();
});

it("edits Run and S&P F1–F12 macros in the durable setup document without sending output", async () => {
  const p = props(); p.value.macros = [{ mode: "R", key: "F1", label: "CQ", template: "CQ {MYCALL}" }, { mode: "S", key: "F12", label: "TU", template: "TU" }];
  render(<ContestSetupPanel {...p}/>); open("Edit Macros");
  for (const mode of ["Run", "S&P"]) for (let key = 1; key <= 12; key++) expect(screen.getByLabelText(`${mode} F${key} template`)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Run F1 label"), { target: { value: "CQ TEST" } });
  fireEvent.change(screen.getByLabelText("S&P F12 template"), { target: { value: "TU {MYCALL}" } });
  expect(p.onSave).not.toHaveBeenCalled(); open("OK");
  await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce());
  expect(p.onSave.mock.calls[0][0].macros).toEqual(expect.arrayContaining([{ mode: "R", key: "F1", label: "CQ TEST", template: "CQ {MYCALL}" }, { mode: "S", key: "F12", label: "TU", template: "TU {MYCALL}" }]));
  expect(p.value.macros[0].label).toBe("CQ");
});

it("uses effective contest defaults for a label-only edit while preserving the source overrides", async () => {
  const p = props();
  const effectiveMacros = (["R", "S"] as const).flatMap(mode => Array.from({ length: 12 }, (_, index) => ({
    mode, key: `F${index + 1}`, label: `${mode} F${index + 1}`, template: `${mode} F${index + 1} {MYCALL}`,
  })));
  render(<ContestSetupPanel {...p} effectiveMacros={effectiveMacros}/>);
  open("Edit Macros"); fireEvent.change(screen.getByLabelText("Run F1 label"), { target: { value: "CQ TEST" } }); open("OK");
  await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce());
  expect(p.onSave.mock.calls[0][0].macros).toEqual([{ mode: "R", key: "F1", label: "CQ TEST", template: "R F1 {MYCALL}" }]);
  expect(p.value.macros).toEqual([]);
});

it("routes every shared service and reports native opening errors without saving draft settings", async () => {
  const p = props(); render(<ContestSetupPanel {...p}/>); open("Station Settings"); open("Open xLog Station settings");
  await waitFor(() => expect(p.onOpenSettings).toHaveBeenCalledWith("Station"));
  await waitFor(() => expect(screen.getByLabelText("City").closest("fieldset")?.disabled).toBe(false));
  open("Cancel"); open("Configuration Settings");
  for (const [tab, service] of [["Lookup", "QRZ"], ["CAT", "Radio"], ["CW", "CW"], ["Cluster", "Cluster"], ["Rotator", "Rotator"]]) {
    fireEvent.click(screen.getByRole("tab", { name: tab })); open(`Open xLog ${service} settings`);
    await waitFor(() => expect(p.onOpenSettings).toHaveBeenCalledWith(service));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false));
  }
  p.onOpenSettings.mockImplementationOnce(() => { throw new Error("Rotor window is unavailable"); });
  open("Open xLog Rotator settings");
  await screen.findByText("Rotor window is unavailable");
  expect(p.onSave).not.toHaveBeenCalled();
});

it("hands shared services to xLog without duplicate editable settings and keeps Sound independent", () => {
  const p = props(); render(<ContestSetupPanel {...p} initialTab="Lookup"/>);
  for (const [tab, service] of [["Lookup", "QRZ"], ["CAT", "Radio"], ["CW", "CW"], ["Rotator", "Rotator"], ["Cluster", "Cluster"]]) {
    fireEvent.click(screen.getByRole("tab", { name: tab }));
    expect(screen.getByRole("status").textContent).toContain(`Managed by xLog ${service} settings`);
    expect(screen.getByRole("button", { name: `Open xLog ${service} settings` })).toBeTruthy();
    if (tab === "Lookup") expect(screen.getByRole("checkbox", { name: "Show QRZ details" })).toBeTruthy();
    else expect(screen.getByRole("tabpanel").querySelector("input,select,textarea")).toBeNull();
  }
  fireEvent.click(screen.getByRole("tab", { name: "Sound" }));
  expect(screen.queryByRole("button", { name: /Open xLog/ })).toBeNull();
  expect(screen.getByLabelText("Sound Output")).toBeTruthy();
  expect(p.onOpenSettings).not.toHaveBeenCalled();
  expect(p.onSave).not.toHaveBeenCalled();
});

it("persists the optional Contest QRZ details preference through the existing setup save", async () => {
  const p = props(); render(<ContestSetupPanel {...p} initialTab="Lookup"/>);
  fireEvent.click(screen.getByRole("checkbox", { name: "Show QRZ details" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(p.onSave).toHaveBeenCalledTimes(1));
  expect(p.onSave.mock.calls[0][0].preferences.showQRZDetails).toBe(true);
});

it("omits inert service defaults from new documents and preserves saved fields without applying them", async () => {
  const p = props();
  const legacy = { lookup: "HamQTH.com", lookupUsername: "old-user", lookupPassword: "test-only-secret", soundDevice: "old-device", phonetic: "NATO",
    catProvider: "flrig", rigControlHost: "192.0.2.1", rigControlPort: 1234, cwProvider: "cwdaemon", cwHost: "192.0.2.2", cwPort: 6789,
    cwWeight: 50, cwLeadMs: 0, cwTailMs: 0, cwSpeedIncrement: "1", cwSendRST: "5NN", cwPaddingCharacter: "0", cwPaddingLength: 1, cwCut1: "1", cwCut9: "9", cwCut0: "0",
    clusterServer: "192.0.2.3", clusterPort: 7373, clusterPassword: "test-only-cluster-secret", clusterFilter: "legacy filter", clusterMode: "FILTER", futureServiceField: "keep" };
  const defaults = newContestSetup().preferences;
  for (const key of Object.keys(legacy)) expect(defaults).not.toHaveProperty(key);
  expect(defaults.cwSpeed).toBe(25);
  Object.assign(p.value.preferences, legacy);
  render(<ContestSetupPanel {...p} initialTab="Lookup"/>);
  expect(document.querySelector('input[type="password"]')).toBeNull();
  open("Save");
  await waitFor(() => expect(p.onSave).toHaveBeenCalledOnce());
  expect(p.onSave.mock.calls[0][0].preferences).toMatchObject(legacy);
  expect(p.onOpenSettings).not.toHaveBeenCalled();
  expect(p.value.preferences).toMatchObject(legacy);
});

it("identifies the shared owner even when native service navigation is unavailable", () => {
  render(<ContestSetupPanel {...props()} onOpenSettings={undefined} initialTab="Cluster"/>);
  expect(screen.getByRole("status").textContent).toContain("Managed by xLog Cluster settings");
  expect(screen.getByText("Open these settings in the main xLog application.")).toBeTruthy();
});
