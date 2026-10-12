// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import OperatorDesk, { rotorPathDistance } from "./OperatorDesk";
import type { RotorSnapshot } from "./rotorControl";
const initial = { id: "native-qso-id", call: "W7AIT", start: "2026-10-11T22:47:12Z", frequencyHz: 18160000, band: "17m", mode: "SSB", rstSent: "59", rstReceived: "59", name: "C OLHEISER, II", comment: "CQ", gridSquare: "CM97LQ", country: "United States of America", county: "Stanislaus", sig: "", extraFields: { APP_CUSTOM: "Keep me" }, customField: { unchanged: true } };
const lookup = { call: "W7AIT", name: "C OLHEISER, II", country: "United States of America", dxcc: 291, gridSquare: "CM97LQ", continent: "NA", cqZone: "5", ituZone: "6", source: "CTY approximate", latitude: 37, longitude: -121, bearing: 73, long_path_bearing: 253, distance_km: 12500 };
const rotor: RotorSnapshot = { owner: "native_dcu1", generation: 4, state: "active", backend_available: true, backend: { connected: true, azimuth: 53, name: "Antenna", status: "Ready" } };
function Harness({ request = vi.fn(async method => method === "logbook_matrix" ? { cells: [] } : { history: { call: "W7AIT", adif: 291, previous_count: 0, previous: [], dxcc_contact_count: 9109, matrix: [{ band: "17m", mode: "SSB", worked: true, confirmed: true }] } }), info = lookup, rotorState = rotor, save = vi.fn(), clear = vi.fn(), onEditor = vi.fn(), onReadRadio = vi.fn(async () => {}), onManualRotor = vi.fn(), switchDraft = false }: any) {
  const [draft, setDraft] = useState<Record<string, any> | null>(initial), [follow, setFollow] = useState(true), [autoRotor, setAutoRotor] = useState(false);
  return <><OperatorDesk draft={draft} setDraft={setDraft} save={save} clear={clear} busy={false} lookup={info} previous={[]} request={request} refresh={0} onEditor={onEditor} onReadRadio={onReadRadio} follow={follow} setFollow={setFollow} rotor={rotorState} autoRotor={autoRotor} setAutoRotor={setAutoRotor} onManualRotor={onManualRotor} />{switchDraft && <button onClick={() => setDraft({ ...initial, id: "new-draft", frequencyHz: 7025000, band: "40m" })}>Switch draft</button>}<output data-testid="draft">{JSON.stringify(draft)}</output></>;
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
it("keeps native QSO identity and unknown metadata while editing references and suspending Follow", async () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("Desk Castle"), { target: { value: "COTA OM-0001" } });
  fireEvent.change(screen.getByLabelText("Desk POTA"), { target: { value: "SK-0001" } });
  fireEvent.change(screen.getByLabelText("Desk Frequency MHz"), { target: { value: "7.025000" } });
  expect(draft()).toMatchObject({ ...initial, frequencyHz: 7025000, band: "40m", sig: "COTA", sigInfo: "COTA OM-0001", potaReference: "SK-0001" });
  expect((screen.getByLabelText("Follow radio") as HTMLInputElement).checked).toBe(false);
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
it("uses observed compass telemetry and sends only explicit generation-fenced LP/Stop motion", async () => {
  const request = vi.fn(async (_method: string, _params?: Record<string, any>) => ({})), onManualRotor = vi.fn();
  render(<Harness request={request} onManualRotor={onManualRotor} />);
  expect(screen.getByLabelText("Observed rotor bearing 53 degrees")).toBeTruthy();
  expect(request.mock.calls.some(([method]) => method.startsWith("rotor_") || method === "station_tune")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Turn rotor long path" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("rotor_goto", { owner: "native_dcu1", generation: 4, bearing: 253, label: "W7AIT" }));
  expect(screen.getByLabelText("LP target bearing 253 degrees")).toBeTruthy();
  expect(screen.getByText("— 27,530 km")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Stop desk rotor" }));
  await waitFor(() => expect(request).toHaveBeenCalledWith("rotor_stop", { owner: "native_dcu1", generation: 4 }));
  expect(onManualRotor).toHaveBeenCalledTimes(2);
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
it("keeps explicit Stop available for uncertain ownership without showing cached bearing as live", async () => {
  render(<Harness rotorState={{ ...rotor, state: "uncertain", backend_available: false }} />);
  expect(screen.getByLabelText("Rotor bearing unavailable")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Stop desk rotor" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Turn rotor short path" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("ROTOR OFFLINE", { exact: false })).toBeTruthy();
});
