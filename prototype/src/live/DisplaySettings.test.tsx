// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ zoom: vi.fn(async (_scale: number) => {}), emit: vi.fn(async () => {}), unlisten: vi.fn(), listener: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ setZoom: mocks.zoom }) }));
vi.mock("@tauri-apps/api/event", () => ({ emit: mocks.emit, listen: async (_name: string, handler: unknown) => { mocks.listener(handler); return mocks.unlisten; } }));
import DisplaySettings from "./DisplaySettings";
import { UiScaleProvider } from "./uiScale";
import { uiScaleKey } from "./uiScaleController";
import { qsoDetailsFieldsKey } from "./qsoEditorPreferences";
import { propagationRefreshKey } from "./propagationPreferences";
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); mocks.zoom.mockImplementation(async () => {}); mocks.emit.mockImplementation(async () => {}); });
afterEach(cleanup);
const mount = () => render(<UiScaleProvider><DisplaySettings /></UiScaleProvider>);
describe("opt-in display controls", () => {
  it("persists the automatic propagation cadence", async () => {
    mount(); await screen.findByText(/Last applied in this window: 100%/);
    expect((screen.getByLabelText("Propagation refresh interval") as HTMLSelectElement).value).toBe("10");
    fireEvent.change(screen.getByLabelText("Propagation refresh interval"), { target: { value: "30" } });
    expect(localStorage.getItem(propagationRefreshKey)).toBe("30");
  });
  it("defaults to 100% and applies an explicit display choice without secret or worker requests", async () => {
    mount(); await waitFor(() => expect(mocks.zoom).toHaveBeenCalledWith(1));
    expect((screen.getByLabelText("Interface display scale") as HTMLSelectElement).value).toBe("1");
    fireEvent.change(screen.getByLabelText("Interface display scale"), { target: { value: "1.5" } });
    await screen.findByText(/Last applied in this window: 150%/);
    expect(mocks.emit).toHaveBeenLastCalledWith("xlog:ui-scale", expect.objectContaining({ version: 1, scale: 1.5 }));
    expect(Object.keys(JSON.parse(localStorage.getItem(uiScaleKey)!)).sort()).toEqual(["revision", "scale", "version", "writer"]);
    expect(mocks.zoom).toHaveBeenLastCalledWith(1.5);
  });
  it("recovers through keyboard Reset from another view after native zoom failure", async () => {
    mocks.zoom.mockImplementation(async scale => { if (scale === 2) throw new Error("internal transport detail"); });
    mount(); await screen.findByText(/Last applied in this window: 100%/);
    fireEvent.change(screen.getByLabelText("Interface display scale"), { target: { value: "2" } });
    expect((await screen.findByRole("alert")).textContent).toContain("could not be applied"); expect(screen.queryByText(/internal transport detail/)).toBeNull();
    fireEvent.keyDown(window, { key: "0", metaKey: true }); await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(mocks.zoom).toHaveBeenLastCalledWith(1); expect((screen.getByLabelText("Interface display scale") as HTMLSelectElement).value).toBe("1");
  });
  it("accepts only newer validated cross-window preferences without rebroadcasting them", async () => {
    mount(); await waitFor(() => expect(mocks.listener).toHaveBeenCalledOnce());
    const record = { version: 1, scale: 1.75, revision: Date.now() + 1, writer: "other-window" };
    fireEvent(window, new StorageEvent("storage", { key: uiScaleKey, newValue: JSON.stringify(record) }));
    await screen.findByText(/Last applied in this window: 175%/); expect(mocks.emit).not.toHaveBeenCalled();
    fireEvent(window, new StorageEvent("storage", { key: uiScaleKey, newValue: JSON.stringify({ ...record, scale: 2, revision: 0 }) }));
    expect((screen.getByLabelText("Interface display scale") as HTMLSelectElement).value).toBe("1.75");
  });
  it("unsubscribes native and keyboard listeners on unmount", async () => {
    const { unmount } = mount(); await waitFor(() => expect(mocks.listener).toHaveBeenCalledOnce()); await screen.findByText(/Last applied in this window: 100%/);
    unmount(); expect(mocks.unlisten).toHaveBeenCalledOnce(); const calls = mocks.zoom.mock.calls.length;
    fireEvent.keyDown(window, { key: "0", ctrlKey: true }); await Promise.resolve(); expect(mocks.zoom).toHaveBeenCalledTimes(calls);
  });
  it("lets the operator choose optional QSO detail fields without affecting core fields", async () => {
    mount(); await screen.findByText(/Last applied in this window: 100%/);
    expect((screen.getByLabelText("Name") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Hide all optional fields" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).checked).toBe(false);
    expect(JSON.parse(localStorage.getItem(qsoDetailsFieldsKey)!)).toEqual({ version: 1, fields: [] });
    fireEvent.click(screen.getByLabelText("POTA"));
    expect(JSON.parse(localStorage.getItem(qsoDetailsFieldsKey)!)).toEqual({ version: 1, fields: ["potaReference"] });
    expect(screen.getByText(/Hiding a field never removes its saved value/)).toBeTruthy();
  });
});
