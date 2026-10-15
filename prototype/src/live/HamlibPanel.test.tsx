// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import HamlibPanel, { HamlibDevice } from "./HamlibPanel";
import { hamlibManufacturers, normalizeHamlibModels } from "./hamlibCatalogue";
import { hamlibProjection } from "./hamlibStation";
const radioModels = [{ id: 1, manufacturer: "Hamlib", model: "Dummy", maturity: "Stable" }, { id: 2045, manufacturer: "Elecraft", model: "KX3", maturity: "Stable" },
  { id: 2046, manufacturer: "Elecraft", model: "K4", maturity: "Beta" }, { id: 3073, manufacturer: "Icom", model: "IC-7300", maturity: "Stable" }];
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
vi.mock("./stationSelection", () => ({ nativeStationSelection: () => true }));
beforeEach(() => localStorage.clear()); afterEach(cleanup);
const fake = () => vi.fn(async (method: string, params?: Record<string, any>) => method === "hamlib_models" ? { models: params?.device === "rotor" ? [{ id: 601, manufacturer: "Yaesu", model: "GS-232", maturity: "Stable" }] : radioModels } : { connected: false });
it("projects exact Hamlib receive capabilities only from explicit VFO and PTT evidence", () => {
  const radio = { generation: 13, observed_at_ms: 10_000, field_observed_at_ms: { vfo: 10_000, ptt: 10_000 }, tx_enabled: true, errors: {},
    fields: { frequency: { Frequency: "14074000" }, mode: { Mode: "PKTUSB" }, vfo: { VFO: "VFOA" }, ptt: { PTT: "0" } } };
  const projected = hamlibProjection(radio, null);
  expect(projected.generation).toBe(13); expect(projected.radio).toMatchObject({ observed: true, connected: true, transmitting: false, receive_vfo: "A" });
  expect(projected.station.supported_commands).toEqual(["set_receive_frequency_a", "set_receive_mode_a"]);
  const unknown = hamlibProjection({ ...radio, fields: { ...radio.fields, ptt: undefined } }, null);
  expect(unknown.radio.transmitting).toBeNull();
});
it("native Desk uses passive shared setup and exposes no raw radio connection form", async () => {
  native.invoke.mockClear(); native.invoke.mockImplementation(async (_command, { params }) => params.action === "hamlib_catalogue" ? { models: radioModels } : { generation: "setup", revision: 1, base_url: "", last_receipt: null,
    hamlib: { mode: "managed", model: 3073, path: "/dev/test-fixture", baud: 9600 }, selection: { provider: "hamlib", generation: 4, selection_id: "selection" } });
  const request = fake(); render(<HamlibPanel request={request} snapshot={null} />);
  await waitFor(() => expect((screen.getByLabelText("Shared Hamlib model ID") as HTMLInputElement).value).toBe("3073"));
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("station_session_request", { params: { action: "snapshot" } });
  expect(request).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Connect radio" })).toBeNull();
  expect(screen.getByRole("button", { name: "Connect saved Hamlib radio" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Load radio model catalogue" }));
  await screen.findByRole("option", { name: "Elecraft KX3 · 2045 · Stable" });
  fireEvent.change(screen.getByLabelText("Shared Hamlib catalogue model"), { target: { value: "2045" } });
  expect((screen.getByLabelText("Shared Hamlib model ID") as HTMLInputElement).value).toBe("2045");
  expect(native.invoke.mock.calls.map(([, { params }]) => params.action)).toEqual(["snapshot", "hamlib_catalogue"]);
  expect(request).not.toHaveBeenCalled();
});
describe("manufacturer-separated Hamlib catalogue", () => {
  it("normalizes manufacturer groups, retains distinct IDs and excludes malformed or duplicate rows", () => {
    const models = normalizeHamlibModels([...radioModels, { id: 999, manufacturer: "elecraft", model: "Prototype", maturity: "Alpha" }, radioModels[1], { id: -1, manufacturer: "Bad", model: "Bad" }, { id: 1000, model: "No manufacturer" }]);
    expect(models).toHaveLength(5); expect(hamlibManufacturers(models).find(group => group.key === "elecraft")?.count).toBe(3);
    expect(models.map(model => model.id)).toContain(2045); expect(models.map(model => model.id)).toContain(2046);
  });
  it("filters manufacturer/model without changing the selected hardware or invoking mutations", async () => {
    localStorage.setItem("xlog.hamlib.radio", JSON.stringify({ mode: "managed", model: 2045, path: "/dev/test-fixture", baud: 9600 }));
    const request = fake(); render(<HamlibDevice device="radio" request={request} />);
    await screen.findByRole("option", { name: "Elecraft KX3 · 2045 · Stable" });
    fireEvent.change(screen.getByLabelText("Radio manufacturer"), { target: { value: "icom" } });
    const model = screen.getByLabelText("Radio model") as HTMLSelectElement;
    expect(model.value).toBe("2045"); expect(within(model).getByRole("option", { name: /KX3.*selected; outside filter/ })).toBeTruthy();
    expect(within(model).getByRole("option", { name: "Icom IC-7300 · 3073 · Stable" })).toBeTruthy(); expect(within(model).queryByRole("option", { name: /Elecraft K4/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Find radio model"), { target: { value: "no matches" } }); expect(model.value).toBe("2045");
    expect(request.mock.calls.every(([method]) => ["hamlib_models", "hamlib_status"].includes(method))).toBe(true);
    expect(JSON.parse(localStorage.getItem("xlog.hamlib.radio")!).model).toBe(2045);
  });
  it("keeps radio/rotor catalogues and model preferences distinct and caches only enumeration", async () => {
    const request = fake(); localStorage.setItem("xlog.hamlib.radio", JSON.stringify({ mode: "managed", model: 3073 }));
    const rotor = { mode: "managed", model: 601, path: "/dev/rotor", baud: 9600, host: "127.0.0.1", port: 4533, serial: {} };
    const { unmount } = render(<><HamlibDevice device="radio" request={request} /><HamlibDevice device="rotor" request={request} configuration={rotor} onConfigurationChange={() => {}} configurationOnly /></>);
    await screen.findByRole("option", { name: "Yaesu GS-232 · 601 · Stable" });
    expect((screen.getByLabelText("Radio model") as HTMLSelectElement).value).toBe("3073"); expect((screen.getByLabelText("Rotor model") as HTMLSelectElement).value).toBe("601");
    expect(within(screen.getByLabelText("Rotor manufacturer")).queryByRole("option", { name: /Icom/ })).toBeNull();
    unmount(); render(<HamlibDevice device="radio" request={request} />); await screen.findByRole("option", { name: "Icom IC-7300 · 3073 · Stable" });
    expect(request.mock.calls.filter(([method]) => method === "hamlib_models")).toHaveLength(2);
  });
  it("reports failure/retries explicitly and never substitutes another saved model", async () => {
    localStorage.setItem("xlog.hamlib.radio", JSON.stringify({ mode: "managed", model: 99999 })); let failed = true;
    const request = vi.fn(async (method: string) => { if (method === "hamlib_models") { if (failed) throw new Error("Catalogue unavailable"); return { models: radioModels }; } return { connected: false }; });
    render(<HamlibDevice device="radio" request={request} />); await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Connect radio" }) as HTMLButtonElement).disabled).toBe(true);
    failed = false; fireEvent.click(screen.getByRole("button", { name: "Reload device catalogue" })); await screen.findByRole("option", { name: "Icom IC-7300 · 3073 · Stable" });
    expect((screen.getByLabelText("Radio model") as HTMLSelectElement).value).toBe("99999"); expect(screen.getByText(/Choose a model from the current bundled catalogue/)).toBeTruthy();
  });
  it("fences a stale catalogue completion when the request adapter changes", async () => {
    let finish!: (value: any) => void;
    const slow = vi.fn((method: string) => method === "hamlib_models" ? new Promise<Record<string, any>>(resolve => { finish = resolve; }) : Promise.resolve({ connected: false }));
    const { rerender } = render(<HamlibDevice device="radio" request={slow} />);
    const fast = fake(); rerender(<HamlibDevice device="radio" request={fast} />); await screen.findByRole("option", { name: "Elecraft KX3 · 2045 · Stable" });
    finish({ models: [{ id: 999, manufacturer: "Stale", model: "Old", maturity: "Beta" }] });
    await waitFor(() => expect(screen.queryByRole("option", { name: /Stale Old/ })).toBeNull());
  });
  it("connects only through explicit action with the exact selected radio model", async () => {
    const request = fake(); render(<HamlibDevice device="radio" request={request} />); await screen.findByRole("option", { name: "Hamlib Dummy · 1 · Stable" });
    fireEvent.change(screen.getByLabelText("Radio model"), { target: { value: "1" } }); fireEvent.click(screen.getByRole("button", { name: "Connect radio" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("hamlib_connect", expect.objectContaining({ device: "radio", model: 1, tx_enabled: false })));
    expect(request.mock.calls.some(([method]) => method === "hamlib_control")).toBe(false);
  });
});
