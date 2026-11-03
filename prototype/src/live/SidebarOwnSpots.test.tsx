// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SidebarOwnSpots, { sidebarOwnSpotItems } from "./SidebarOwnSpots";
import { ownRbnReceivers } from "./ownRbnMap";
import { parseOwnRBN } from "./hfPropagationModel";
import { loadOwnRBNPickups } from "./ownRbnFeed";

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("keeps only recent exact-call pickups and distinguishes RBN from human spots", () => {
  const now = Date.parse("2026-10-18T03:22:00Z");
  const items = sidebarOwnSpotItems([
    { id:"1", callsign:"OM0RX", spotter:"LZ7AA", frequencyKHz:3515.9, band:"80m", mode:"CW", source:"rbl", comment:"+12 dB 22 WPM", arrivedAt:"2026-10-18T03:21:30Z" },
    { id:"2", callsign:"OM0RX", spotter:"VK8NSB", frequencyKHz:3516.2, band:"80m", mode:"CW", source:"cluster", comment:"Strong signal", arrivedAt:"2026-10-18T03:20:00Z" },
    { id:"3", callsign:"OM0RY", spotter:"PA5KT4", frequencyKHz:3515.9, band:"80m", mode:"CW", source:"rbl", comment:"+18 dB", arrivedAt:"2026-10-18T03:21:40Z" },
    { id:"4", callsign:"OM0RX", spotter:"OLD", frequencyKHz:3515.9, band:"80m", mode:"CW", source:"rbl", comment:"+1 dB", arrivedAt:"2026-10-18T03:00:00Z" },
    { id:"5", callsign:"OM0RX", spotter:"TWELVE", frequencyKHz:3517.1, band:"80m", mode:"CW", source:"cluster", comment:"Human report", arrivedAt:"2026-10-18T03:10:00Z" },
  ], [], "om0rx", now);
  expect(items.map(item => [item.spotter, item.source])).toEqual([["LZ7AA", "rbl"], ["VK8NSB", "cluster"], ["TWELVE", "cluster"]]);
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

it("keeps the saved operator window separate from the fixed RBN query and caption", async () => {
  localStorage.setItem("xlog.own-spots.window-minutes.v1", "30");
  const request = vi.fn(async () => ({ result: { page: { rows: [] } } }));
  const rbnTransport = vi.fn(async () => JSON.stringify({ spots: {}, call_info: {} }));
  render(<SidebarOwnSpots request={request} ownCall="OM0RX" liveSpots={[]} connected={false} rbnTransport={rbnTransport} />);
  await waitFor(() => expect(rbnTransport).toHaveBeenCalledWith("own_rbn", { sinceSeconds:600, ownCall:"OM0RX" }));
  expect(screen.getByText("RBN: last 10 min · Operator spots: last 30 min.")).toBeTruthy();
  expect(screen.getByText("No pickups in these windows.")).toBeTruthy();
});

it.each([[599,true],[600,true],[601,false]] as const)("shares inclusive RBN source expiry at %s seconds across sidebar and map", (seconds,current) => {
  const now=1_800_000_000_000,time=now-seconds*1000;
  const raw={id:"report",callsign:"OM0RX",spotter:"RX1",frequencyKHz:14025,band:"20m",mode:"CW",source:"rbl",receivedAt:time};
  const parsed=parseOwnRBN({spots:{report:["RX1",14025,"OM0RX",0,null,"",0,0,0,1,time/1000]}},"OM0RX");
  expect(sidebarOwnSpotItems([raw],[],"OM0RX",now,15)).toHaveLength(current?1:0);
  expect(ownRbnReceivers(parsed,"OM0RX",null,now)).toHaveLength(current?1:0);
  const human={...raw,id:"human",spotter:"HUMAN",source:"cluster",receivedAt:now-720_000};
  expect(sidebarOwnSpotItems([human],[],"OM0RX",now,15)).toHaveLength(1);
  expect(sidebarOwnSpotItems([human],[],"OM0RX",now,5)).toHaveLength(0);
});

it("expires sidebar RBN by clock during fetch failure without a cluster connection", async () => {
  vi.useFakeTimers();const now=Date.now();
  const rbnTransport=vi.fn().mockResolvedValueOnce(JSON.stringify({spots:{a:["RX1",14025,"OM0RX",0,null,"",0,0,0,1,(now-590_000)/1000]}})).mockRejectedValue(new Error("offline"));
  const request=vi.fn();
  render(<SidebarOwnSpots request={request} ownCall="OM0RX" liveSpots={[]} connected={false} rbnTransport={rbnTransport}/>);
  await act(async()=>{});expect(screen.getByText("RX1")).toBeTruthy();
  await act(async()=>{await vi.advanceTimersByTimeAsync(20_000);});
  expect(rbnTransport).toHaveBeenCalledTimes(1);expect(screen.queryByText("RX1")).toBeNull();
  await act(async()=>{await vi.advanceTimersByTimeAsync(100_000);});
  expect(rbnTransport).toHaveBeenCalledTimes(2);expect(screen.queryByText("RX1")).toBeNull();
  expect(screen.getByText("RBN: last 10 min · Operator spots: last 15 min.")).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
});

it("does not freshen old source timestamps when cached or fetched again", async () => {
  vi.useFakeTimers();const now=Date.now();
  const transport=vi.fn(async()=>JSON.stringify({spots:{a:["RX1",14025,"OM0RX",0,null,"",0,0,0,1,(now-599_000)/1000]}}));
  expect(await loadOwnRBNPickups(transport,"OM0RX",120_000)).toHaveLength(1);
  vi.advanceTimersByTime(2000);
  expect(await loadOwnRBNPickups(transport,"OM0RX",120_000)).toHaveLength(0);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(await loadOwnRBNPickups(transport,"OM0RX",0)).toHaveLength(0);
  expect(transport).toHaveBeenCalledTimes(2);
});

it("releases hidden sidebar reads and re-ages retained reports on showing even when refresh fails", async () => {
  vi.useFakeTimers();const now=Date.now();let visible=true;
  vi.spyOn(document,"visibilityState","get").mockImplementation(()=>visible?"visible":"hidden");
  const request=vi.fn().mockResolvedValueOnce({page:{rows:[]}}).mockRejectedValue(new Error("archive offline"));
  const rbnTransport=vi.fn().mockResolvedValueOnce(JSON.stringify({spots:{a:["HIDDEN-RX",14025,"OM0RX",0,null,"",0,0,0,1,(now-590_000)/1000]}})).mockRejectedValue(new Error("RBN offline"));
  render(<SidebarOwnSpots request={request} ownCall="OM0RX" liveSpots={[]} connected rbnTransport={rbnTransport}/>);
  await act(async()=>{});expect(screen.getByText("HIDDEN-RX")).toBeTruthy();
  expect(request).toHaveBeenCalledTimes(1);expect(rbnTransport).toHaveBeenCalledTimes(1);
  visible=false;await act(async()=>document.dispatchEvent(new Event("visibilitychange")));
  await act(async()=>{await vi.advanceTimersByTimeAsync(240_000);});
  expect(request).toHaveBeenCalledTimes(1);expect(rbnTransport).toHaveBeenCalledTimes(1);
  expect(screen.getByText("HIDDEN-RX")).toBeTruthy(); // The hidden projection was retained.
  visible=true;await act(async()=>document.dispatchEvent(new Event("visibilitychange")));
  expect(request).toHaveBeenCalledTimes(2);expect(rbnTransport).toHaveBeenCalledTimes(2);
  expect(screen.queryByText("HIDDEN-RX")).toBeNull();
  expect(screen.getByText("No pickups in these windows.")).toBeTruthy();
});
