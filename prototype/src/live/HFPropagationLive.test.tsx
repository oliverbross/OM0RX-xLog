// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  expect(screen.getByRole("heading", { name: "HF Propagation live" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Band × continent activity" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "NOAA SWPC outlook" })).toBeTruthy();
  const layout = screen.getByRole("button", { name: "Layout" });
  expect(layout.compareDocumentPosition(screen.getByRole("button", { name: "Settings" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(layout);
  expect(screen.getByRole("heading", { name: "Dashboard layout" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Information size"), { target: { value: "compact" } });
  expect(screen.getByLabelText("HF Propagation live").classList.contains("is-compact")).toBe(true);
  expect(screen.getByRole("separator", { name: "Propagation dashboard column width" }).getAttribute("aria-valuenow")).toBe("59");
  fireEvent.keyDown(screen.getByRole("separator", { name: "Propagation dashboard column width" }), { key: "ArrowRight" });
  expect(screen.getByRole("separator", { name: "Propagation dashboard column width" }).getAttribute("aria-valuenow")).toBe("61");
  expect(screen.getByRole("heading", { name: "Modes per band" }).closest(".hf-prop-area-modes")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "OM0RX WSPR paths" }).closest(".hf-prop-area-paths")).toBeTruthy();
  await waitFor(() => expect(screen.getByText("7/7 products live")).toBeTruthy());
  expect(screen.getByRole("heading", { name: "OM0RX RBN pickups" })).toBeTruthy();
  expect(screen.getByText("MM9PSY")).toBeTruthy();
  expect(screen.getByText("+21 dB")).toBeTruthy();
  expect(transport).toHaveBeenCalledWith("wspr", expect.objectContaining({ bands: expect.arrayContaining([14]) }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByRole("heading", { name: "HF propagation settings" })).toBeTruthy();
  expect(screen.getByText(/never radio or rotor control/i)).toBeTruthy();
  expect(screen.queryByText(/Switch to operate/i)).toBeNull();
});
