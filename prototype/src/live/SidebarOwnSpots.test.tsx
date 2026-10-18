// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SidebarOwnSpots, { sidebarOwnSpotItems } from "./SidebarOwnSpots";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("keeps only recent exact-call pickups and distinguishes RBN from human spots", () => {
  const now = Date.parse("2026-10-18T03:22:00Z");
  const items = sidebarOwnSpotItems([
    { id:"1", callsign:"OM0RX", spotter:"LZ7AA", frequencyKHz:3515.9, band:"80m", mode:"CW", source:"rbl", comment:"+12 dB 22 WPM", arrivedAt:"2026-10-18T03:21:30Z" },
    { id:"2", callsign:"OM0RX", spotter:"VK8NSB", frequencyKHz:3516.2, band:"80m", mode:"CW", source:"cluster", comment:"Strong signal", arrivedAt:"2026-10-18T03:20:00Z" },
    { id:"3", callsign:"OM0RY", spotter:"PA5KT4", frequencyKHz:3515.9, band:"80m", mode:"CW", source:"rbl", comment:"+18 dB", arrivedAt:"2026-10-18T03:21:40Z" },
    { id:"4", callsign:"OM0RX", spotter:"OLD", frequencyKHz:3515.9, band:"80m", mode:"CW", source:"rbl", comment:"+1 dB", arrivedAt:"2026-10-18T03:00:00Z" },
  ], [], "om0rx", now);
  expect(items.map(item => [item.spotter, item.source])).toEqual([["LZ7AA", "rbl"], ["VK8NSB", "cluster"]]);
});

it("polls the unfiltered archive and renders compact RBN and spotted cards", async () => {
  const now = Date.now();
  const request = vi.fn(async () => ({ result: { page: { rows: [
    { id:"1", callsign:"OM0RX", spotter:"PA5KT4", frequencyKHz:3515.9, band:"80m", mode:"CW", source:"rbl", comment:"+18 dB 22 WPM", arrivedAt:new Date(now - 20_000).toISOString() },
    { id:"2", callsign:"OM0RX", spotter:"VK8NSB", frequencyKHz:3516.2, band:"80m", mode:"CW", source:"cluster", comment:"Strong signal", arrivedAt:new Date(now - 80_000).toISOString() },
  ] } } }));
  render(<SidebarOwnSpots request={request} ownCall="OM0RX" liveSpots={[]} connected />);
  await waitFor(() => expect(screen.getByText("PA5KT4")).toBeTruthy());
  expect(screen.getByText("VK8NSB")).toBeTruthy();
  expect(screen.getByText("RBN")).toBeTruthy(); expect(screen.getByText("SPOT")).toBeTruthy();
  expect(request).toHaveBeenCalledWith("spot_history_query", expect.objectContaining({ call:"OM0RX", match:"exact", limit:12 }));
});

it("does not poll the archive while the cluster is disconnected", async () => {
  const request = vi.fn(async () => ({ result: { page: { rows: [] } } }));
  render(<SidebarOwnSpots request={request} ownCall="OM0RX" liveSpots={[]} connected={false} />);
  await Promise.resolve();
  expect(request).not.toHaveBeenCalled();
});

it("shows direct RBN pickups while the cluster archive is disconnected", async () => {
  const request = vi.fn(async () => ({ result: { page: { rows: [] } } }));
  const rbnTransport = vi.fn(async () => JSON.stringify({
    spots: { "42": ["KM3T5", "10116.1", "OM0RX", 5, 23, "0401z", 0, 7, 1, 1, Math.floor(Date.now() / 1000)] },
    call_info: { KM3T5: ["K", "United States", "NA", "usa", "5", "8", "40", "-75", "FN20", "skimmer"] },
  }));
  render(<SidebarOwnSpots request={request} ownCall="OM0RX" liveSpots={[]} connected={false} rbnTransport={rbnTransport} />);
  await waitFor(() => expect(screen.getByText("KM3T5")).toBeTruthy());
  expect(screen.getByText("RBN")).toBeTruthy();
  expect(screen.getByTitle("+5 dB · 23 WPM · FN20")).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
  expect(rbnTransport).toHaveBeenCalledWith("own_rbn", { sinceSeconds:600, ownCall:"OM0RX" });
});
