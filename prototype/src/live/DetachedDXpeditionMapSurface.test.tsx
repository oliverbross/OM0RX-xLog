// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DetachedDXpeditionMapSurface, requestDXpeditionMap } from "./DetachedDXpeditionMapSurface";
import { loadWindowSurface } from "../windowSurface";

const api = vi.hoisted(() => ({ worker: vi.fn(), tune: vi.fn(), load: vi.fn(), refresh: vi.fn(), mode: "normal_logging" }));
vi.mock("../operatingModule", () => ({ operatingModuleStatus: async () => ({ selected: api.mode, transitioning: false }) }));
vi.mock("../worker", () => ({ workerRequest: api.worker }));
vi.mock("./useSpotActivation", () => ({ useSpotActivation: (command = "activate_spot") => ({
  status: null, error: "", requesting: false, activate: command === "activate_opportunity" ? api.load : api.tune,
  reconcile: vi.fn(),
}) }));
vi.mock("./useMapContext", () => ({ useMapContext: () => ({
  context: { cluster: { response: { contest_spots: [{ id: "cluster-1", callsign: "VK9X2", frequencyKHz: 14_074.5,
    band: "20m", mode: "FT8", receivedAt: "2026-10-24T00:00:00Z", spotter: "W1AAA",
    activation: { sourceEpoch: "cluster", spotVersion: "spot" } }] } },
    selection: { radio_id: "radio1", provider: "direct_tci" }, radio: { snapshot: { radio: { frequency_hz: 14_025_000 } } } },
  stale: false, error: "", refresh: api.refresh,
}) }));
vi.mock("../Map", () => ({ default: ({ data, onSpot }: { data: { id: string; call: string }[]; onSpot: (spot: { id: string }) => void }) =>
  <div>{data.map(spot => <button key={spot.id} onClick={() => onSpot(spot)}>{`Pin ${spot.call}`}</button>)}</div> }));
vi.mock("./SpotActivationStatus", () => ({ SpotActivationStatus: () => null }));

const activation = { sourceEpoch: "feed", spotVersion: "row" };
const snapshot = { generated_at: "2026-10-24T00:00:00Z", total_available: 2, surface: "dxpedition-map",
  sources: [{ source: "adxo", state: "fresh", count: 2, last_success: "2026-10-24T00:00:00Z", safe_error: null, source_url: "https://www.ng3k.com/Misc/adxoplain.html" }],
  items: [
    { id: "adxo:vk9x", kind: "dxpedition", callsign: "VK9X1", aliases: ["VK9X2"], name: "Christmas Island", comment: "",
      source: "NG3K ADXO", source_url: "https://www.ng3k.com/Misc/adxoplain.html", starts_at: "2026-10-20T00:00:00Z", ends_at: "2026-10-30T23:59:59Z",
      latitude: -10.49, longitude: 105.63, activation },
    { id: "adxo:p5", kind: "dxpedition", callsign: "P5ABC", aliases: [], name: "DPRK", comment: "",
      source: "NG3K ADXO", source_url: "https://www.ng3k.com/Misc/adxoplain.html", starts_at: "2026-10-27T00:00:00Z", ends_at: "2026-10-29T23:59:59Z",
      latitude: null, longitude: null, activation },
  ] };

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-24T00:01:00Z")); api.mode = "normal_logging"; });
afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); vi.useRealTimers(); });

function deferredSnapshot() {
  let resolve!: (value: { result: typeof snapshot }) => void;
  const promise = new Promise<{ result: typeof snapshot }>(done => { resolve = done; });
  return { promise, resolve };
}

it("displays cached operations while refresh is held and focus reads do not discard its result", async () => {
  const refresh = deferredSnapshot();
  api.worker.mockImplementation((method: string) => method === "opportunities_dxpedition_refresh"
    ? refresh.promise : Promise.resolve({ result: snapshot }));
  render(<DetachedDXpeditionMapSurface />);
  expect(await screen.findByText("VK9X1")).toBeTruthy();
  fireEvent(window, new Event("focus"));
  await waitFor(() => expect(api.worker.mock.calls.filter(([method]) => method === "opportunities_dxpedition_snapshot")).toHaveLength(2));
  refresh.resolve({ result: { ...snapshot, items: [{ ...snapshot.items[0], callsign: "NEW1" }] } });
  expect(await screen.findByText("NEW1")).toBeTruthy();
  expect(screen.queryByText("VK9X1")).toBeNull();
});

it("does not let an older cached read overwrite a completed provider refresh", async () => {
  const cached = deferredSnapshot();
  api.worker.mockImplementation((method: string) => method === "opportunities_dxpedition_snapshot"
    ? cached.promise : Promise.resolve({ result: { ...snapshot, items: [{ ...snapshot.items[0], callsign: "NEW1" }] } }));
  render(<DetachedDXpeditionMapSurface />);
  expect(await screen.findByText("NEW1")).toBeTruthy();
  await act(async () => { cached.resolve({ result: snapshot }); });
  expect(screen.queryByText("VK9X1")).toBeNull();
  expect(screen.getByText("NEW1")).toBeTruthy();
});

it("registers the detached route and rejects methods outside its two-method feed boundary", async () => {
  expect((await loadWindowSurface("?view=dxpedition-map")).name).toBe("DetachedDXpeditionMapSurface");
  await expect(requestDXpeditionMap("settings_load" as never)).rejects.toThrow("unavailable");
  expect(api.worker).not.toHaveBeenCalled();
});

it("keeps cards and pins passive, then tunes only from the explicit frequency action", async () => {
  api.worker.mockResolvedValue({ result: snapshot }); api.tune.mockResolvedValue({}); api.load.mockResolvedValue({});
  render(<DetachedDXpeditionMapSurface />);
  const card = (await screen.findByText("VK9X1")).closest("button")!;
  fireEvent.click(card);
  fireEvent.click(screen.getByRole("button", { name: "Pin VK9X1" }));
  expect(api.tune).not.toHaveBeenCalled(); expect(api.load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Tune & load" }));
  await waitFor(() => expect(api.tune).toHaveBeenCalledWith({ id: "cluster-1", activation: { sourceEpoch: "cluster", spotVersion: "spot" } }));
  expect(api.worker.mock.calls.every(([method]) => ["opportunities_dxpedition_snapshot", "opportunities_dxpedition_refresh"].includes(method))).toBe(true);
});

it("uses the catalogue token for callsign-only draft loading and never emits a QSO write", async () => {
  api.worker.mockResolvedValue({ result: snapshot }); api.tune.mockResolvedValue({}); api.load.mockResolvedValue({});
  render(<DetachedDXpeditionMapSurface />);
  fireEvent.click((await screen.findByText("P5ABC")).closest("button")!);
  fireEvent.click(screen.getByRole("button", { name: "Load callsign" }));
  await waitFor(() => expect(api.load).toHaveBeenCalledWith({ id: "adxo:p5", activation }));
  expect(api.worker.mock.calls.some(([method]) => /contact|qso|draft_apply/.test(method))).toBe(false);
});

it("moves keyboard focus into details and restores it when Escape closes the drawer", async () => {
  api.worker.mockResolvedValue({ result: snapshot });
  render(<DetachedDXpeditionMapSurface />);
  const card = (await screen.findByText("VK9X1")).closest("button")!;
  card.focus(); fireEvent.click(card);
  await waitFor(() => expect(screen.getByRole("button", { name: "Close details" })).toBe(document.activeElement));
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(card).toBe(document.activeElement));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("recovers invalid saved filters and switches the complete navigation shell to Italian", async () => {
  localStorage.setItem("xlog.dxpedition-map.status", "invalid"); localStorage.setItem("xlog.dxpedition-map.band", "2m");
  api.worker.mockResolvedValue({ result: snapshot });
  render(<DetachedDXpeditionMapSurface />);
  expect(await screen.findByText("VK9X1")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "IT" }));
  expect(screen.getByRole("heading", { name: "Mappa DXpedition" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Filtro stato" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Elenco DXpedition" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Mappa spedizioni" })).toBeTruthy();
});

it("shows real enrichment and worked history and explains disabled contest actions", async () => {
  api.mode = "contesting";
  api.worker.mockResolvedValue({ result: { ...snapshot, items: [{ ...snapshot.items[0], qso_total: 45535,
    last_qso_at: "2026-10-24T00:00:00Z", callsign_history: { worked_count: 3, confirmed_count: 2, worked_modes: ["CW"], confirmed_modes: ["FT8"] } }] } });
  render(<DetachedDXpeditionMapSurface />);
  fireEvent.click((await screen.findByText("VK9X1")).closest("button")!);
  expect(screen.getAllByText(/45,535/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/3 worked · 2 confirmed/).length).toBeGreaterThan(0);
  expect(await screen.findByText(/Use the contest Cluster/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Tune & load" }).hasAttribute("disabled")).toBe(true);
  expect(api.tune).not.toHaveBeenCalled();
});

it("shows retained archive frequencies without giving them tuning authority", async () => {
  api.worker.mockResolvedValue({ result: { ...snapshot, observations: [{ id: "history:old", callsign: "VK9X1", frequencyKHz: 21025,
    band: "15m", mode: "CW", receivedAt: "2026-10-23T12:00:00Z" }] } });
  render(<DetachedDXpeditionMapSurface />);
  fireEvent.click((await screen.findByText("VK9X1")).closest("button")!);
  expect(screen.getByText("21.025000 MHz")).toBeTruthy();
  expect(screen.getByRole("button", { name: /History only/ }).hasAttribute("disabled")).toBe(true);
});
