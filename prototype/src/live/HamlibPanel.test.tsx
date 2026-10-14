// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HamlibDevice } from "./HamlibPanel";
import { hamlibManufacturers, normalizeHamlibModels } from "./hamlibCatalogue";
const radioModels = [{ id: 1, manufacturer: "Hamlib", model: "Dummy", maturity: "Stable" }, { id: 2045, manufacturer: "Elecraft", model: "KX3", maturity: "Stable" },
  { id: 2046, manufacturer: "Elecraft", model: "K4", maturity: "Beta" }, { id: 3073, manufacturer: "Icom", model: "IC-7300", maturity: "Stable" }];
beforeEach(() => localStorage.clear()); afterEach(cleanup);
const fake = () => vi.fn(async (method: string, params?: Record<string, any>) => method === "hamlib_models" ? { models: params?.device === "rotor" ? [{ id: 601, manufacturer: "Yaesu", model: "GS-232", maturity: "Stable" }] : radioModels } : { connected: false });
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
