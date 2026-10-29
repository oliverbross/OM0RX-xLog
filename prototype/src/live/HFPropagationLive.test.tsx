// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import HFPropagationLive from "./HFPropagationLive";
import { loadWindowSurface } from "../windowSurface";
import { DetachedHFPropagationLiveSurface } from "./DetachedHFPropagationLiveSurface";

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it("loads the detached propagation surface without mounting the station workspace", async () => {
  expect(await loadWindowSurface("?view=hf-propagation-live")).toBe(DetachedHFPropagationLiveSurface);
});

it("renders the complete native dashboard and keeps its settings isolated from station control", async () => {
  const transport = vi.fn(async (source: string) => {
    if (source === "wspr") return JSON.stringify({ data: [["2026-10-18 00:02:00", 14, "OM0RX", "VK8NSB", 13400]] });
    if (source === "own_wspr") return JSON.stringify({ data: [["2026-10-18 00:02:00", 14, "OM0RX", "VK8NSB", -13]] });
    if (source === "pskr") return '<receptionReport flowStartSeconds="1792281720" senderCallsign="JA1ABC" receiverCallsign="W1AW" frequency="14074000" mode="FT8"/>';
    if (source === "dxheat") return JSON.stringify([{ Frequency: "14025", DXCall: "G3ABC", Spotter: "K1ABC", Date: "18/10/26", Time: "00:10", Mode: "CW", Continent_dx: "EU", Continent_spotter: "NA" }]);
    if (source === "own_rbn") return JSON.stringify({ spots: { "42": ["MM9PSY", "3555.7", "OM0RX", 21, 18, "0229z", 0, 7, 1, 1, Math.floor(Date.now() / 1000)] }, call_info: { MM9PSY: ["GM", "Scotland", "EU", "scotland", "27", "14", "56", "-3", "IO86HA", "skimmer"] } });
    if (source === "swpc_forecast") return "GEOMAGNETIC ACTIVITY\nQuiet to unsettled.\nSOLAR RADIATION STORM\nNo storm expected.\nRADIO BLACKOUT\nR1 possible.\nFORECASTER";
    if (source === "swpc_sfi") return JSON.stringify([{ flux: 145 }]);
    if (source === "swpc_kp") return JSON.stringify([{ Kp: 2, a_running: 7 }]);
    if (source === "swpc_wind") return JSON.stringify([{ proton_speed: 410 }]);
    if (source === "swpc_xray") return JSON.stringify([{ energy: "0.1-0.8nm", flux: 0.0000012 }]);
    if (source === "swpc_ssn") return JSON.stringify([{ ssn: 121 }]);
    if (source === "swpc_kp_forecast") return JSON.stringify([{ time_tag: "2026-10-18T00:00:00", kp: "2", observed: "observed" }]);
    throw new Error(`Unexpected source ${source}`);
  });
  render(<HFPropagationLive initialOwnCall="OM0RX" initialLocator="JN88TQ" transport={transport} />);
  const title = screen.getByRole("heading", { name: "HF Propagation live" });
  expect(title).toBeTruthy();
  const header = within(title.closest("header")!);
  expect(screen.getByRole("heading", { name: "Band × continent activity" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "NOAA SWPC outlook" })).toBeTruthy();
  const arrange = header.getByRole("button", { name: "Arrange panels" });
  expect(arrange.compareDocumentPosition(header.getByRole("button", { name: "Settings" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(arrange);
  expect(header.getByRole("button", { name: "Finish arranging" })).toBeTruthy();
  const activityPanel = within(screen.getByLabelText("Band × continent activity panel"));
  expect(activityPanel.getByRole("button", { name: "Move Band × continent activity" })).toBeTruthy();
  expect(activityPanel.getByRole("button", { name: "Resize Band × continent activity right edge" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Information size"), { target: { value: "compact" } });
  expect(screen.getByLabelText("HF Propagation live").classList.contains("is-compact")).toBe(true);
  const resize = activityPanel.getByRole("button", { name: "Resize Band × continent activity right edge" });
  fireEvent.keyDown(resize, { key: "ArrowRight" });
  fireEvent.keyUp(resize, { key: "ArrowRight" });
  await waitFor(() => expect(JSON.parse(localStorage.getItem("xlog.hf-propagation.canvas-layout.v1") || "{}").panels
    .find((panel: { id: string }) => panel.id === "band-continent").rect.width).toBeGreaterThan(950));
  expect(screen.getByRole("heading", { name: "Modes per band" }).closest(".hf-prop-canvas-panel")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "OM0RX WSPR paths" }).closest(".hf-prop-canvas-panel")).toBeTruthy();
  await waitFor(() => expect(screen.getByText("7/7 products live")).toBeTruthy());
  expect(screen.getByRole("heading", { name: "OM0RX RBN pickups" })).toBeTruthy();
  expect(screen.getByText("MM9PSY")).toBeTruthy();
  expect(screen.getByText("+21 dB")).toBeTruthy();
  expect(transport).toHaveBeenCalledWith("wspr", expect.objectContaining({ bands: expect.arrayContaining([14]) }));
  fireEvent.click(header.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole("heading", { name: "HF propagation settings" })).toBeTruthy();
  expect(screen.getByText(/never radio or rotor control/i)).toBeTruthy();
  expect(screen.queryByText(/Switch to operate/i)).toBeNull();
});
