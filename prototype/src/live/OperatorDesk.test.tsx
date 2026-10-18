// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import OperatorDesk, { rotorPathDistance } from "./OperatorDesk";
import type { RotorSnapshot } from "./rotorControl";
const initial = { id: "native-qso-id", call: "W7AIT", start: "2026-10-11T22:47:12Z", frequencyHz: 18160000, band: "17m", mode: "SSB", rstSent: "59", rstReceived: "59", name: "C OLHEISER, II", comment: "CQ", gridSquare: "CM97LQ", country: "United States of America", county: "Stanislaus", sig: "", extraFields: { APP_CUSTOM: "Keep me" }, customField: { unchanged: true } };
const lookup = { call: "W7AIT", name: "C OLHEISER, II", country: "United States of America", dxcc: 291, gridSquare: "CM97LQ", continent: "NA", cqZone: "5", ituZone: "6", source: "CTY approximate", latitude: 37, longitude: -121, bearing: 73, long_path_bearing: 253, distance_km: 12500 };
const rotor: RotorSnapshot = { owner: "native_dcu1", generation: 4, state: "active", backend_available: true, backend: { connected: true, azimuth: 53, name: "Antenna", status: "Ready" } };
function Harness({ request = vi.fn(async method => method === "logbook_matrix" ? { cells: [] } : { history: { call: "W7AIT", adif: 291, previous_count: 0, previous: [], dxcc_contact_count: 9109, matrix: [{ band: "17m", mode: "SSB", worked: true, confirmed: true }] } }), info = lookup, rotorState = rotor, save = vi.fn(), clear = vi.fn(), onEditor = vi.fn(), onReadRadio = vi.fn(async () => {}), onManualRotor = vi.fn(), switchDraft = false, initialDraft = initial, intelligenceBands }: any) {
  const [draft, setDraft] = useState<Record<string, any> | null>(initialDraft), [follow, setFollow] = useState(true), [autoRotor, setAutoRotor] = useState(false);
  return <><OperatorDesk draft={draft} setDraft={setDraft} save={save} clear={clear} busy={false} lookup={info} previous={[]} request={request} refresh={0} onEditor={onEditor} onReadRadio={onReadRadio} follow={follow} setFollow={setFollow} rotor={rotorState} autoRotor={autoRotor} setAutoRotor={setAutoRotor} onManualRotor={onManualRotor} intelligenceBands={intelligenceBands} />{switchDraft && <button onClick={() => setDraft({ ...initial, id: "new-draft", frequencyHz: 7025000, band: "40m" })}>Switch draft</button>}<output data-testid="draft">{JSON.stringify(draft)}</output></>;
}
const draft = () => JSON.parse(screen.getByTestId("draft").textContent || "{}");
afterEach(cleanup);
it("shows all native top-strip fields and actions together with the three panels", async () => {
  render(<Harness />);
  for (const name of ["Active QSO", "Callsign & DXCC intelligence", "Rotor"]) expect(screen.getByRole("heading", { name })).toBeTruthy();
  for (const name of ["Callsign", "Frequency MHz", "Band", "Mode", "RST S", "RST R", "Name", "Comment", "Grid", "Country", "County", "POTA", "SOTA", "IOTA", "WWFF", "Castle"]) expect(screen.getByLabelText(`Desk ${name}`)).toBeTruthy();
  expect((screen.getByLabelText("Desk UTC date") as HTMLInputElement).value).toBe("2026-10-11");
  expect((screen.getByLabelText("Desk UTC time") as HTMLInputElement).value).toBe("22:47:12");
  expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("18.160000");
  for (const name of ["Full editor", "Read radio", "Clear QSO", "Log QSO"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  await waitFor(() => expect(screen.getByLabelText("DXCC 17m: Confirmed")).toBeTruthy());
});
it("puts an advisory duplicate date below the reference fields without blocking logging", async () => {
  const save = vi.fn();
  const request = vi.fn(async (method: string) => method === "logbook_duplicate"
    ? { call: "W7AIT", band: "17m", mode: "SSB", last_worked_at: "2026-01-02T23:55:00Z" }
    : method === "logbook_matrix" ? { cells: [] } : { history: { call: "W7AIT", adif: 291, previous_count: 1, previous: [], matrix: [] } });
  render(<Harness request={request} save={save} />);
  const warning = await screen.findByText("Dupe: Worked on 02/01/26");
  const form = screen.getByLabelText("Active QSO").querySelector("form")!;
  const references = form.querySelector(".desk-active-references")!;
  expect(warning.parentElement).toBe(form);
  expect(references.nextElementSibling).toBe(warning);
  expect(screen.getByRole("heading", { name: "Active QSO" }).parentElement?.contains(warning)).toBe(false);
  expect(warning.getAttribute("role")).toBe("status");
  const log = screen.getByRole("button", { name: "Log QSO" }) as HTMLButtonElement;
  expect(log.disabled).toBe(false);
  fireEvent.click(log);
  expect(save).toHaveBeenCalledOnce();
});
it("keeps field labels and entered defaults while leaving every empty text field without a placeholder", () => {
  render(<Harness initialDraft={{ ...initial, call: "", name: "", comment: "", gridSquare: "", country: "", county: "", potaReference: "", sotaReference: "", iota: "", wwffReference: "", sigInfo: "" }} />);
  const active = screen.getByRole("region", { name: "Active QSO" });
  for (const input of active.querySelectorAll("input")) expect(input.hasAttribute("placeholder")).toBe(false);
  expect((screen.getByLabelText("Desk RST S") as HTMLInputElement).value).toBe("59");
  expect((screen.getByLabelText("Desk RST R") as HTMLInputElement).value).toBe("59");
  expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("18.160000");
  expect((screen.getByLabelText("Desk Band") as HTMLSelectElement).value).toBe("17m");
  expect((screen.getByLabelText("Desk Mode") as HTMLSelectElement).value).toBe("SSB");
});
it("shortens metre labels in both compact grids while retaining canonical status matching and full units", async () => {
  const cells = [{ band: "160m", mode: "CW", worked: true, confirmed: true }, { band: "80m", mode: "CW", worked: true, confirmed: false }];
  const request = vi.fn(async (method: string) => method === "logbook_matrix" ? { cells }
    : { history: { call: "W7AIT", adif: 291, previous_count: 0, previous: [], matrix: cells } });
  render(<Harness request={request} intelligenceBands={["160m", "80m", "70cm"]} />);
  await waitFor(() => expect(screen.getByLabelText("DXCC 160m: Confirmed")).toBeTruthy());
  for (const scope of ["Callsign", "DXCC"]) {
    const confirmed = screen.getByLabelText(`${scope} 160m: Confirmed`);
    const worked = screen.getByLabelText(`${scope} 80m: Worked`);
    expect(confirmed.textContent).toBe("● 160");
    expect(worked.textContent).toBe("○ 80");
    expect(confirmed.getAttribute("title")).toBe("160m: Confirmed across logged modes");
    expect(worked.getAttribute("title")).toBe("80m: Worked across logged modes");
    expect(screen.getByLabelText(`${scope} 70cm: Unworked`).textContent).toBe("— 70cm");
  }
  expect(draft().band).toBe("17m");
});
it("keeps native QSO identity and unknown metadata while editing references and suspending Follow", async () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Desk Castle"), { target: { value: "COTA OM-0001" } });
  fireEvent.change(screen.getByLabelText("Desk POTA"), { target: { value: "SK-0001" } });
  fireEvent.change(screen.getByLabelText("Desk Frequency MHz"), { target: { value: "7.025000" } });
  expect(draft()).toMatchObject({ ...initial, frequencyHz: 7025000, band: "40m", sig: "COTA", sigInfo: "COTA OM-0001", potaReference: "SK-0001" });
  expect(screen.queryByLabelText("Follow radio")).toBeNull();
  fireEvent.change(screen.getByLabelText("Desk UTC time"), { target: { value: "23:15:30" } });
  expect(draft().start).toBe("2026-10-11T23:15:30Z");
});
it("does not save invalid manual MHz or incomplete UTC and leaves readback failures intact", async () => {
  const save = vi.fn(), onReadRadio = vi.fn(async () => { throw new Error("Radio offline"); });
  render(<Harness save={save} onReadRadio={onReadRadio} />);
  fireEvent.change(screen.getByLabelText("Desk Frequency MHz"), { target: { value: "invalid" } });
  expect(draft().frequencyHz).toBe(18160000);
  expect((screen.getByRole("button", { name: "Log QSO" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  await screen.findByText("Radio offline");
  expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("invalid");
  fireEvent.change(screen.getByLabelText("Desk UTC date"), { target: { value: "" } });
  fireEvent.keyDown(screen.getByLabelText("Desk Callsign"), { key: "Enter", ctrlKey: true });
  expect(save).not.toHaveBeenCalled();
});
it("renders authoritative whole-log contact totals and last DXCC QSO, not matrix or loaded-page counts", async () => {
  const request = vi.fn(async (method: string) => method === "logbook_matrix" ? { cells: [{ band: "20m", mode: "CW", worked: true, confirmed: false }] }
    : { history: { call: "W7AIT", adif: 291, previous_count: 30, previous_confirmed_count: 25, previous: [{ date: "2026-01-02T01:47:00Z" }], dxcc_contact_count: 9109, dxcc_confirmed_count: 7076, last_dxcc_qso: { date: "2026-01-11T01:47:00Z", call: "K1ABC" }, matrix: [{ band: "17m", mode: "FT8", worked: true, confirmed: true }] } });
  render(<Harness request={request} />);
  await waitFor(() => expect(screen.getByLabelText("DXCC 17m: Confirmed")).toBeTruthy());
  expect(screen.getByLabelText("Callsign 20m: Worked")).toBeTruthy();
  expect(screen.getByText("9,109 worked · 7,076 confirmed")).toBeTruthy();
  expect(screen.getByText("30 worked · 25 confirmed")).toBeTruthy();
  expect(screen.getByText(/DXCC LAST · 11\/01\/2026, 01:47/)).toBeTruthy();
  expect(request).toHaveBeenCalledWith("logbook_matrix", { call: "W7AIT" });
  expect(request).toHaveBeenCalledWith("cluster_history", { call: "W7AIT", adif: 291 });
  expect(request.mock.calls.some(([method]) => method.startsWith("rotor_") || method === "station_tune")).toBe(false);
});
it("abbreviates large counts in both grids while exposing full worked and confirmed meaning", async () => {
  const request = vi.fn(async (method: string) => method === "logbook_matrix" ? { cells: [] }
    : { history: { call: "W7AIT", adif: 291, previous_count: 6317, previous_confirmed_count: 2782, previous: [], dxcc_contact_count: 9876543, dxcc_confirmed_count: 1234567, matrix: [] } });
  render(<Harness request={request} />);
  await waitFor(() => expect(screen.getByTitle("6,317 worked · 2,782 confirmed")).toBeTruthy());
  for (const [short, full] of [["6,317 wkd · 2,782 cnf", "6,317 worked · 2,782 confirmed"], ["9,876,543 wkd · 1,234,567 cnf", "9,876,543 worked · 1,234,567 confirmed"]]) {
    const summary = screen.getByTitle(full);
    expect(within(summary).getByText(short).getAttribute("aria-hidden")).toBe("true");
    expect(within(summary).getByText(full).className).toBe("desk-count-full");
  }
});
it("leaves missing confirmed totals unknown rather than deriving them from band cells", async () => {
  render(<Harness />);
  await waitFor(() => expect(screen.getByLabelText("DXCC 17m: Confirmed")).toBeTruthy());
  expect(screen.getByText("9,109 worked · — confirmed")).toBeTruthy();
  expect(screen.getByText("DXCC LAST · Unavailable")).toBeTruthy();
});
it("never shows stale lookup or mismatched history as current evidence", async () => {
  const request = vi.fn(async () => ({ history: { call: "OTHER", adif: 291, previous_count: 0, matrix: [] } }));
  render(<Harness request={request} info={{ ...lookup, call: "OTHER", source: "QRZ stale", country: "Wrong country" }} />);
  await screen.findByText("Local history evidence is unavailable or incomplete.");
  expect(screen.queryByText("QRZ stale")).toBeNull();
  expect(screen.queryByText("Wrong country")).toBeNull();
  expect(screen.getByLabelText("DXCC 17m: Unknown")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Turn rotor long path" }) as HTMLButtonElement).disabled).toBe(true);
});
it("does not let stale draft country/location label a new call's matched intelligence", () => {
  const entered = { ...initial, call: "OM0AAO", country: "ENGLAND", dxcc: 223, name: "Old name", gridSquare: "IO91AA" };
  render(<Harness initialDraft={entered} info={{ ...lookup, call: "OM0AAO", name: "Viliam Pertik", country: "Slovak Republic", dxcc: 504, gridSquare: "JN88WT" }} />);
  const intelligence = within(screen.getByRole("region", { name: "Callsign and DXCC intelligence" }));
  expect(intelligence.getByText("Slovak Republic")).toBeTruthy();
  expect(intelligence.getByText("#504")).toBeTruthy();
  expect(intelligence.queryByText("ENGLAND")).toBeNull();
  expect(intelligence.queryByText("Old name")).toBeNull();
  expect(intelligence.getByText("JN88WT")).toBeTruthy();
  expect(draft()).toEqual(entered);
});
it("uses observed compass telemetry and sends only explicit generation-fenced path motion", async () => {
  const request = vi.fn(async (_method: string, _params?: Record<string, any>) => ({})), onManualRotor = vi.fn();
  render(<Harness request={request} onManualRotor={onManualRotor} />);
  expect(screen.getByLabelText("Observed rotor bearing 53 degrees")).toBeTruthy();
  expect(request.mock.calls.some(([method]) => method.startsWith("rotor_") || method === "station_tune")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Turn rotor long path" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("rotor_goto", { owner: "native_dcu1", generation: 4, bearing: 253, label: "W7AIT" }));
  expect(screen.getByLabelText("LP target bearing 253 degrees")).toBeTruthy();
  expect(within(screen.getByLabelText("Observed rotor bearing 53 degrees")).getByText("27,530 km")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Stop desk rotor" })).toBeNull();
  expect(onManualRotor).toHaveBeenCalledTimes(1);
});
it("keeps the dial readout responsive while placing SP/LP in opposite Rotor card corners", async () => {
  render(<Harness />);
  const panel = screen.getByRole("region", { name: "Rotor" });
  const dial = within(panel).getByRole("img", { name: "Observed rotor bearing 53 degrees" });
  for (const text of ["W7AIT", "053°", "OBSERVED", "SP 73° TARGET", "12,500 km"]) expect(within(dial).getByText(text)).toBeTruthy();
  expect(panel.querySelector(".desk-rotor-target")).toBeNull();
  const controls = panel.querySelector<HTMLElement>(".rotor-path-controls")!;
  const shortPath = within(controls).getByRole("button", { name: "Turn rotor short path" });
  const longPath = within(controls).getByRole("button", { name: "Turn rotor long path" });
  expect(controls.firstElementChild).toBe(shortPath);
  expect(controls.lastElementChild).toBe(longPath);
  expect(panel.querySelector(".desk-rotor-controls")).toBeNull();
  expect(panel.querySelector(".desk-rotor-body > .rotor-dial-shell > .rotor-dial")).toBe(dial);
  expect(panel.querySelector(".desk-rotor-body > .rotor-dial-shell > .rotor-path-controls")).toBe(controls);
  expect(dial.parentElement).toBe(controls.parentElement);
  fireEvent.click(longPath);
  await waitFor(() => expect(within(dial).getByText("LP 253° TARGET")).toBeTruthy());
  expect(within(dial).getByText("27,530 km")).toBeTruthy();
  expect(within(dial).getByText("053°")).toBeTruthy();
  expect(within(panel).queryByRole("checkbox", { name: "Auto rotor" })).toBeNull();
});
it("keeps unknown target and distance explicit inside the dial instead of using stale lookup data", () => {
  render(<Harness info={{ ...lookup, call: "OTHER" }} rotorState={{ ...rotor, state: "uncertain", backend_available: false }} />);
  const dial = screen.getByRole("img", { name: "Rotor bearing unavailable" });
  for (const text of ["W7AIT", "---°", "NO TELEMETRY", "SP ---° TARGET"]) expect(within(dial).getByText(text)).toBeTruthy();
  expect(within(dial).queryByText("Distance unavailable")).toBeNull();
  expect(dial.querySelector(".rotor-observed-needle")).toBeNull();
  expect(dial.querySelector(".rotor-target-marker")).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "Auto rotor" })).toBeNull();
});
it("derives LP distance with the native geodesy radius and rejects missing/impossible distances", () => {
  expect(rotorPathDistance(12500, "SP")).toBe(12500);
  expect(rotorPathDistance(12500, "LP")).toBeCloseTo(2 * Math.PI * 6371.0088 - 12500);
  for (const value of [null, undefined, NaN, Infinity, -1, 40000]) expect(rotorPathDistance(value, "LP")).toBeUndefined();
});
it("does not clear a new draft's manual MHz buffer when an old Read radio callback completes", async () => {
  let complete: null | (() => void) = null;
  render(<Harness switchDraft onReadRadio={() => new Promise<void>(resolve => { complete = resolve; })} />);
  fireEvent.click(screen.getByRole("button", { name: "Read radio" }));
  fireEvent.click(screen.getByRole("button", { name: "Switch draft" }));
  fireEvent.change(screen.getByLabelText("Desk Frequency MHz"), { target: { value: "manual-invalid" } });
  await act(async () => { (complete as unknown as () => void)(); });
  expect((screen.getByLabelText("Desk Frequency MHz") as HTMLInputElement).value).toBe("manual-invalid");
  expect(draft()).toMatchObject({ id: "new-draft", frequencyHz: 7025000 });
});
it("removes the desk Stop while keeping uncertain ownership from exposing stale path motion", async () => {
  render(<Harness rotorState={{ ...rotor, state: "uncertain", backend_available: false }} />);
  expect(screen.getByLabelText("Rotor bearing unavailable")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Stop desk rotor" })).toBeNull();
  expect((screen.getByRole("button", { name: "Turn rotor short path" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("ROTOR OFFLINE", { exact: false })).toBeTruthy();
});
