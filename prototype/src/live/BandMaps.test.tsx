// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BAND_RANGES, BandMaps, BandMapsToolbarContext, bandForRadio, opportunityCode, placeSpots, panBandRange, bandMapCapacity, bandMapFrequencyTicks, bandMapLaneGeometry, bandMapSpotWidth, bandMapOverflowHeight, bandMapSpotColor, contestBandMapSpotColor, contestBandMapSpotWorked, deduplicateBandMapSpots, filterRecentBandMapSpots, formatBandMapFrequency } from "./BandMaps";
import type { BandMapViewPreferences } from "./BandMaps";
import { defaultContestBandPlan } from "../contesting/contestBandPlan";

const spot = (id: string, frequencyKHz: number, band = "20m", callStatus = "New Call", dxccStatus = "Worked") => ({
  id, callsign: id, frequencyKHz, band, mode: "CW", callStatus, dxccStatus,
  comment: "live cluster spot", country: "Slovakia", source: "cluster", statusHex: "#CC372D",
});

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps remaining contest markers and DOM positions when a worked neighbour disappears",()=>{
  const rows=["LONGESTCALL/P","K1ABC","DL1ABC"].map((call,index)=>({...spot(call,7120,"40m"),mode:"SSB",contestDupe:false,
    contestMultiplierCount:0,contestCountryMultiplier:false,contestZoneMultiplier:false,id:String(index)}));
  const view=render(<BandMaps compact contestPresentation spots={rows} onSelect={vi.fn()} radioFrequencyHz={7120000}/>);
  const before=screen.getByRole("button",{name:/^K1ABC ·/}) as HTMLElement;
  const position=[before.style.left,before.style.top];
  view.rerender(<BandMaps compact contestPresentation spots={rows.slice(1).map(row=>({...row,id:`new-${row.id}`,contestMultiplierCount:1,contestCountryMultiplier:true}))} onSelect={vi.fn()} radioFrequencyHz={7120000}/>);
  const after=screen.getByRole("button",{name:/^K1ABC ·/}) as HTMLElement;
  expect(after).toBe(before);expect([after.style.left,after.style.top]).toEqual(position);
  expect(after.style.color).toBe("rgb(255, 82, 103)");
});

it("shows unresolved classification as pending rather than a grey worked station",()=>{
  render(<BandMaps compact contestPresentation spots={[{...spot("PENDING",7120,"40m"),mode:"SSB"}]} onSelect={vi.fn()} radioFrequencyHz={7120000}/>);
  const pending=screen.getByRole("button",{name:/^PENDING ·/}) as HTMLElement;
  expect(pending.classList.contains("is-pending")).toBe(true);
  expect(pending.classList.contains("is-worked")).toBe(false);
  expect(pending.title).toContain("Classification pending");
  expect(pending.style.color).toBe("rgb(217, 181, 111)");
});

it("keeps the zoomed range and exact clicked spot frequency when the observed VFO changes",()=>{
  vi.stubGlobal("PointerEvent",MouseEvent);
  const sx={...spot("SX5P",7147,"40m"),mode:"SSB",contestDupe:false,contestMultiplierCount:1};
  const other={...sx,id:"other",callsign:"K1ABC",frequencyKHz:7172};
  const onSelect=vi.fn(),props={compact:true,contestPresentation:true,spots:[sx,other],onSelect};
  const view=render(<BandMaps {...props} radioFrequencyHz={7172000}/>);
  fireEvent.change(screen.getByLabelText("Band map resolution"),{target:{value:"5"}});
  const before=screen.getByLabelText(/^40m spectrum,/);
  const range=before.getAttribute("aria-label");
  const marker=screen.getByRole("button",{name:/^SX5P ·/});
  before.setPointerCapture=vi.fn();before.hasPointerCapture=()=>true;before.releasePointerCapture=vi.fn();
  fireEvent.pointerDown(marker,{button:0,clientY:100});
  fireEvent.pointerMove(before,{button:0,clientY:130});
  fireEvent.pointerUp(before,{button:0,clientY:130});
  expect(before.getAttribute("aria-label")).toBe(range);
  fireEvent.click(marker,{detail:1});
  expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({id:"SX5P",callsign:"SX5P",frequencyKHz:7147}));
  view.rerender(<BandMaps {...props} spots={[{...sx,contestMultiplierCount:0},other]} radioFrequencyHz={7147000} selectedSpotId="SX5P"/>);
  expect(screen.getByLabelText(/^40m spectrum,/)).toBe(before);
  expect(before.getAttribute("aria-label")).toBe(range);
  expect(screen.getByRole("img",{name:"Current VFO 7.147.0 MHz"})).toBeTruthy();
});

it("explains only locally observed filtering counts without inventing upstream received totals",()=>{
  const now=Date.now()/1000-978307200;
  const base={...spot("K1ABC",7120,"40m"),mode:"SSB",receivedAt:now};
  render(<BandMaps compact contestPresentation contestAllowedModes={["phone"]} radioFrequencyHz={7120000} onSelect={vi.fn()} spots={[
    base,{...base,id:"old",callsign:"OLD",receivedAt:now-86400},
    {...base,id:"repeat",receivedAt:now-60},
    {...base,id:"worked",callsign:"WORKED",contestDupe:true},
    {...base,id:"other",callsign:"OTHER",band:"20m",frequencyKHz:14200},
    {...base,id:"cw",callsign:"CW",mode:"CW",frequencyKHz:7020},
    {...base,id:"fresh",callsign:"FRESH",frequencyKHz:7125},
  ]}/>);
  fireEvent.click(screen.getByText("Filter details"));
  const counts=screen.getByLabelText("40m filter counts");
  const count=(label:string)=>within(counts).getByText(label).nextElementSibling?.textContent;
  expect(count("Supplied reports")).toBe("7");expect(count("Expired / future dated")).toBe("1");
  expect(count("Superseded reports")).toBe("1");expect(count("Worked hidden")).toBe("1");
  expect(count("Mode / search hidden")).toBe("1");expect(count("Other bands")).toBe("1");
  expect(count("Displayed markers")).toBe("2");
});

describe("native band-map parity", () => {
  it("merges only the same callsign-frequency occurrence and retains a real QSY", () => {
    const now = Date.UTC(2026, 9, 16, 12, 0, 0);
    const appleNow = now / 1000 - 978_307_200;
    const old = { ...spot("old", 14023.7), callsign: "OK2BUH", receivedAt: appleNow - 60 };
    const newest = { ...spot("new", 14023.7), callsign: "ok2buh", receivedAt: appleNow };
    const qsy = { ...spot("qsy", 14025), callsign: "OK2BUH", receivedAt: appleNow - 20 };
    expect(deduplicateBandMapSpots([old, newest, qsy]).map(item => item.id)).toEqual(["new", "qsy"]);
    expect(deduplicateBandMapSpots([old, newest, qsy], true).map(item => item.id)).toEqual(["new"]);
  });

  it("resolves equal-time duplicate updates deterministically", () => {
    const receivedAt = Date.now() / 1000 - 978_307_200;
    const first = { ...spot("a", 14023.7), callsign: "OK2BUH", receivedAt, comment: "first" };
    const winner = { ...spot("z", 14023.7), callsign: "ok2buh", receivedAt, comment: "updated" };
    expect(deduplicateBandMapSpots([winner, first])[0]).toBe(winner);
    expect(deduplicateBandMapSpots([first, winner])[0]).toBe(winner);
  });

  it("collapses reports at the displayed 100 Hz precision and retains authoritative contest classification", () => {
    const receivedAt = Date.now() / 1000 - 978_307_200;
    const classified = { ...spot("classified", 7181.399, "40m"), callsign:"PJ4G", receivedAt,
      contestPoints:0,contestDupe:true,contestMultiplierCount:0,contestCountryMultiplier:false,contestZoneMultiplier:false };
    const newerFeedCopy = { ...spot("newer", 7181.401, "40m"), callsign:"pj4g", receivedAt:receivedAt+1,
      contestPoints:null,contestDupe:null,contestMultiplierCount:null,contestCountryMultiplier:null,contestZoneMultiplier:null };
    const rows = deduplicateBandMapSpots([classified,newerFeedCopy]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({id:"newer",contestDupe:true,contestMultiplierCount:0});
    expect(contestBandMapSpotColor(rows[0])).toBe("#aeb5b7");
  });

  it("prefers the immediate worked classification when duplicate feed copies still disagree", () => {
    const receivedAt = Date.now() / 1000 - 978_307_200;
    const stale = { ...spot("stale", 14215, "20m"), callsign:"LN8W", mode:"SSB", receivedAt:receivedAt+1,
      contestPoints:3,contestDupe:false,contestMultiplierCount:2,contestCountryMultiplier:true,contestZoneMultiplier:true };
    const worked = { ...spot("worked", 14215, "20m"), callsign:"LN8W", mode:"SSB", receivedAt,
      contestPoints:0,contestDupe:true,contestMultiplierCount:0,contestCountryMultiplier:false,contestZoneMultiplier:false };
    expect(deduplicateBandMapSpots([worked,stale])).toEqual([expect.objectContaining({id:"stale",contestDupe:true,
      contestPoints:0,contestMultiplierCount:0,contestCountryMultiplier:false,contestZoneMultiplier:false})]);
  });

  it("does not merge the same callsign and frequency across operating modes", () => {
    const cw = { ...spot("cw", 7100, "40m"), callsign:"OM0RX", mode:"CW" };
    const ssb = { ...spot("ssb", 7100, "40m"), callsign:"OM0RX", mode:"SSB" };
    expect(deduplicateBandMapSpots([cw, ssb]).map(item => item.id)).toEqual(["cw", "ssb"]);
  });

  it("filters by spot age without hiding legacy reports that have no trustworthy timestamp", () => {
    const now = Date.UTC(2026, 9, 16, 12, 0, 0);
    const appleNow = now / 1000 - 978_307_200;
    const recent = { ...spot("recent", 14020), receivedAt: appleNow - 29 * 60 };
    const old = { ...spot("old", 14021), receivedAt: appleNow - 31 * 60 };
    const legacy = spot("legacy", 14022);
    expect(filterRecentBandMapSpots([recent, old, legacy], 30, now).map(item => item.id)).toEqual(["recent", "legacy"]);
  });

  it("formats the scale in compact grouped notation", () => {
    expect(formatBandMapFrequency(7000)).toBe("7.000.0");
    expect(formatBandMapFrequency(14023.7)).toBe("14.023.7");
    expect(bandMapFrequencyTicks({ low: 14000, high: 14350 })).toEqual([14000, 14050, 14100, 14150, 14200, 14250, 14300, 14350]);
    expect(bandMapFrequencyTicks({ low: 7000, high: 7200 }, 1000)).toEqual(Array.from({ length: 41 }, (_, index) => 7000 + index * 5));
  });

  it("renders a repeated report once and activates the newest original record", () => {
    const onSelect = vi.fn();
    const appleNow = Date.now() / 1000 - 978_307_200;
    const old = { ...spot("old", 14023.7), callsign: "OK2BUH", receivedAt: appleNow - 100 };
    const newest = { ...spot("new", 14023.7), callsign: "OK2BUH", receivedAt: appleNow };
    render(<BandMaps spots={[old, newest]} onSelect={onSelect} />);
    const markers = screen.getAllByRole("button", { name: /OK2BUH.*14\.023\.7 MHz/ });
    expect(markers).toHaveLength(1);
    fireEvent.click(markers[0]);
    expect(onSelect).toHaveBeenCalledWith(newest);
  });

  it("renders separate frequencies for the same callsign without repeating either occurrence", () => {
    const appleNow = Date.now() / 1000 - 978_307_200;
    const first = { ...spot("first", 14023.7), callsign: "OK2BUH", receivedAt: appleNow };
    const firstCopy = { ...first, id: "first-copy", receivedAt: appleNow + 1 };
    const qsy = { ...spot("qsy", 14025), callsign: "OK2BUH", receivedAt: appleNow + 2 };
    render(<BandMaps spots={[first, firstCopy, qsy]} onSelect={vi.fn()} />);
    expect(screen.getAllByRole("button", { name: /OK2BUH/ })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /14\.023\.7 MHz/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /14\.025\.0 MHz/ })).toBeTruthy();
  });

  it("offers compact bottom controls for band, resolution and spot age", () => {
    const changeBand = vi.fn();
    render(<BandMaps focusedBand="40m" onFocusedBandChange={changeBand} spots={[]} onSelect={vi.fn()}
      preferences={{ bands: ["40m"], followRadio: false, layout: "row", fontScale: 1 }} />);
    fireEvent.change(screen.getByLabelText("Band"), { target: { value: "20m" } });
    expect(changeBand).toHaveBeenCalledWith("20m");
    fireEvent.change(screen.getByLabelText("Band map resolution"), { target: { value: "5" } });
    expect((screen.getByLabelText("Band map resolution") as HTMLSelectElement).value).toBe("5");
    expect(screen.getByLabelText("40m spectrum, 7.098.0–7.202.0 MHz")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Band map resolution"), { target: { value: "10" } });
    expect(screen.getByLabelText("40m spectrum, 7.124.0–7.176.0 MHz")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Spot age"), { target: { value: "45" } });
    expect((screen.getByLabelText("Spot age") as HTMLSelectElement).value).toBe("45");
  });
  it("focused window keeps one band despite radio and workspace preferences and exposes modes only through its gear", () => {
    const change = vi.fn(), select = vi.fn();
    const preferences: BandMapViewPreferences = { bands: ["20m", "40m"], followRadio: true, layout: "grid", fontScale: 1, modes: ["cw", "phone", "data"] };
    const props = { focusedBand: "40m", spots: [spot("CW40", 7020, "40m"), { ...spot("SSB40", 7120, "40m"), mode: "SSB" }, spot("CW20", 14020)], onSelect: select, preferences, onPreferencesChange: change };
    const { rerender } = render(<BandMaps {...props} radioFrequencyHz={14025000} />);
    expect(screen.getByRole("region", { name: "40m band map" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "20m band map" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Band maps" })).toBeNull();
    expect(screen.queryByLabelText("Add band map")).toBeNull();
    expect(screen.queryByLabelText("Follow radio")).toBeNull();
    expect(screen.queryByText("Search")).toBeNull();
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("40m mode visibility settings"));
    fireEvent.click(screen.getByRole("checkbox", { name: "SSB / Phone" }));
    expect(change).toHaveBeenCalledWith({ ...preferences, modes: ["cw", "data"] });
    rerender(<BandMaps {...props} preferences={{ ...preferences, modes: ["cw"] }} radioFrequencyHz={21025000} />);
    expect(screen.queryByRole("button", { name: /SSB40 ·/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /CW40 ·/ })); expect(select).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /CW20 ·/ })).toBeNull();
  });
  it("presents the contest map as a narrow single-band instrument that follows band changes", () => {
    const onSelect = vi.fn();
    localStorage.setItem("xlog.integration.bandMaps.contest.bands", JSON.stringify(["40m", "20m"]));
    const spots = [spot("CW20", 14020), spot("CW40", 7020, "40m"), spot("CW15", 21020, "15m")];
    const { rerender } = render(<BandMaps compact contestPresentation storageNamespace="contest" spots={spots} onSelect={onSelect} radioFrequencyHz={14_025_000} />);
    const surface = screen.getByLabelText("Band maps");
    expect(surface.classList.contains("band-maps-contest")).toBe(true);
    expect(screen.getByRole("region", { name: "20m band map" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "40m band map" })).toBeNull();
    expect(screen.queryByLabelText("Add band map")).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Follow radio" })).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom 20m out" }).textContent).toBe("−");
    expect(screen.getByRole("button", { name: "Zoom 20m in" }).textContent).toBe("+");
    expect(screen.getByText("Clear older")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Band"), { target: { value: "40m" } });
    expect(screen.getByRole("region", { name: "40m band map" })).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
    rerender(<BandMaps compact contestPresentation storageNamespace="contest" spots={spots} onSelect={onSelect} radioFrequencyHz={21_025_000} />);
    expect(screen.getByRole("region", { name: "15m band map" })).toBeTruthy();
  });
  it("applies compact contest mode filters and limits a phone-only map to its saved segment", () => {
    localStorage.setItem("xlog.integration.bandMaps.contest.modes", JSON.stringify(["phone"]));
    const plan = defaultContestBandPlan(["40m"]);
    const spots = [
      { ...spot("CW40", 7020, "40m"), comment: "CQ" },
      { ...spot("DATA40", 7060, "40m"), mode: "RTTY", comment: "CQ" },
      { ...spot("PHONE40", 7120, "40m"), mode: "SSB", comment: "CQ" },
      { ...spot("EXPLICITCW", 7150, "40m"), mode: "SSB", comment: "CW UP 1" },
      { ...spot("REPORTEDCW", 7155, "40m"), comment: "CQ" },
    ];
    render(<BandMaps compact contestPresentation storageNamespace="contest" contestBandPlan={plan}
      spots={spots} onSelect={vi.fn()} radioFrequencyHz={7_150_000} />);
    expect(screen.queryByRole("button", { name: /CW40 ·/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /DATA40 ·/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /EXPLICITCW ·/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /REPORTEDCW ·/ })).toBeNull();
    expect(screen.getByRole("button", { name: /PHONE40 ·/ })).toBeTruthy();
    expect(screen.getByText("7.050.0–7.200.0 MHz")).toBeTruthy();
  });
  it("does not reclassify shared FT8 reports as phone in the overlapping CQ WW range",()=>{
    const plan=defaultContestBandPlan(["40m"]);
    render(<BandMaps compact contestPresentation storageNamespace="contest.ft8" contestBandPlan={plan}
      contestBands={["40m"]} contestAllowedModes={["phone"]} radioFrequencyHz={7_125_000} onSelect={vi.fn()}
      spots={[{...spot("FT8CALL",7074,"40m"),mode:"FT8",comment:"Tnx for QSO"},
        {...spot("PHONELOW",7060,"40m"),mode:"SSB",comment:"CQ TEST"}]}/>);
    expect(screen.queryByRole("button",{name:/FT8CALL ·/})).toBeNull();
    expect(screen.getByRole("button",{name:/PHONELOW ·/})).toBeTruthy();
  });
  it("uses explicit CQ WW SSB bands and phone mode even when a stale saved mode is disallowed", () => {
    localStorage.setItem("xlog.integration.bandMaps.contest.session-a.modes", JSON.stringify(["cw"]));
    const plan = defaultContestBandPlan(["40m"]);
    const spots = [
      { ...spot("CW40", 7020, "40m"), comment: "CQ" },
      { ...spot("PHONE40", 7120, "40m"), mode: "SSB", comment: "CQ" },
      { ...spot("EXPLICITCW", 7150, "40m"), comment: "CW UP 1" },
      { ...spot("PHONE20", 14200, "20m"), mode: "SSB", comment: "CQ" },
    ];
    render(<BandMaps compact contestPresentation storageNamespace="contest.session-a" contestBandPlan={plan}
      contestBands={["40m"]} contestAllowedModes={["phone"]} spots={spots} onSelect={vi.fn()} radioFrequencyHz={7_150_000}/>);
    expect(Array.from((screen.getByLabelText("Band") as HTMLSelectElement).options).map(option => option.value)).toEqual(["40m"]);
    expect(screen.queryByRole("button", { name: /CW40 ·/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /EXPLICITCW ·/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /PHONE20 ·/ })).toBeNull();
    expect(screen.getByRole("button", { name: /PHONE40 ·/ })).toBeTruthy();
    expect(screen.getByText("7.050.0–7.200.0 MHz")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("40m mode visibility settings"));
    expect(screen.getByRole("checkbox", { name: "SSB / Phone" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "CW" })).toBeNull();
  });
  it("moves a green contest VFO marker with the observed radio frequency and hides it outside the visible segment", () => {
    const plan = defaultContestBandPlan(["40m"]);
    const props = { compact:true, contestPresentation:true, storageNamespace:"contest.vfo", contestBandPlan:plan,
      contestBands:["40m"], contestAllowedModes:["phone" as const], spots:[], onSelect:vi.fn() };
    const { rerender } = render(<BandMaps {...props} radioFrequencyHz={7_150_000}/>);
    const marker = screen.getByRole("img", { name:"Current VFO 7.150.0 MHz" });
    expect(marker.classList.contains("band-map-vfo-marker")).toBe(true);
    expect(Number.parseFloat(marker.style.top)).toBeCloseTo(66.67,1);
    rerender(<BandMaps {...props} radioFrequencyHz={7_200_000}/>);
    expect(screen.getByRole("img", { name:"Current VFO 7.200.0 MHz" }).style.top).toBe("100%");
    rerender(<BandMaps {...props} radioFrequencyHz={7_020_000}/>);
    expect(screen.queryByRole("img", { name:/Current VFO/ })).toBeNull();
    rerender(<BandMaps {...props} radioFrequencyHz={undefined}/>);
    expect(screen.queryByRole("img", { name:/Current VFO/ })).toBeNull();
  });
  it("does not add the contest VFO marker to normal Band Maps", () => {
    render(<BandMaps compact spots={[]} onSelect={vi.fn()} radioFrequencyHz={7_150_000}
      preferences={{ bands:["40m"], followRadio:true, layout:"row", fontScale:1 }}/>);
    expect(screen.queryByRole("img", { name:/Current VFO/ })).toBeNull();
  });
  it("keeps contest mode preferences isolated by session namespace", () => {
    localStorage.setItem("xlog.integration.bandMaps.contest.session-a.modes", JSON.stringify(["phone"]));
    localStorage.setItem("xlog.integration.bandMaps.contest.session-b.modes", JSON.stringify(["cw"]));
    const plan = defaultContestBandPlan(["40m"]);
    const spots = [
      { ...spot("CW40", 7020, "40m"), comment: "CQ" },
      { ...spot("PHONE40", 7120, "40m"), mode: "SSB", comment: "CQ" },
    ];
    const first = render(<BandMaps compact contestPresentation storageNamespace="contest.session-a" contestBandPlan={plan}
      contestBands={["40m"]} spots={spots} onSelect={vi.fn()} radioFrequencyHz={7_150_000}/>);
    expect(screen.getByRole("button", { name: /PHONE40 ·/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /CW40 ·/ })).toBeNull();
    first.unmount();
    render(<BandMaps compact contestPresentation storageNamespace="contest.session-b" contestBandPlan={plan}
      contestBands={["40m"]} spots={spots} onSelect={vi.fn()} radioFrequencyHz={7_020_000}/>);
    expect(screen.getByRole("button", { name: /CW40 ·/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /PHONE40 ·/ })).toBeNull();
  });
  it("falls back to the allowed phone mode when controlled preferences came from a CW contest", () => {
    const plan = defaultContestBandPlan(["40m"]);
    const preferences: BandMapViewPreferences = { bands: ["40m"], followRadio: false, layout: "row", fontScale: 1, modes: ["cw"] };
    render(<BandMaps compact contestPresentation storageNamespace="contest.session-ssb" contestBandPlan={plan}
      contestBands={["40m"]} contestAllowedModes={["phone"]} preferences={preferences} onPreferencesChange={vi.fn()}
      spots={[{ ...spot("CW40", 7020, "40m"), comment: "CQ" }, { ...spot("PHONE40", 7120, "40m"), mode: "SSB", comment: "CQ" }]}
      onSelect={vi.fn()} radioFrequencyHz={7_150_000}/>);
    expect(screen.queryByRole("button", { name: /CW40 ·/ })).toBeNull();
    expect(screen.getByRole("button", { name: /PHONE40 ·/ })).toBeTruthy();
  });
  it("uses authoritative contest dupes and needed multipliers for N1MM colors",()=>{
    const needed={...spot("needed",14020),callsign:"LONG/CALLSIGN1",callStatus:"New Call",dxccStatus:"New Country",workedBefore:null,
      contestPoints:1,contestDupe:false,contestMultiplierCount:0,contestCountryMultiplier:false,contestZoneMultiplier:false};
    const country={...needed,id:"country",callsign:"VK1ABC",frequencyKHz:14021,contestPoints:3,contestMultiplierCount:1,
      contestCountryMultiplier:true,contestZoneMultiplier:false};
    const zone={...needed,id:"zone",callsign:"VK2ABC",frequencyKHz:14021.5,contestPoints:3,contestMultiplierCount:1,
      contestCountryMultiplier:false,contestZoneMultiplier:true};
    const double={...needed,id:"double",callsign:"JA1ABC",frequencyKHz:14022,contestPoints:0,contestMultiplierCount:2,
      contestCountryMultiplier:true,contestZoneMultiplier:true};
    const twoPoint={...needed,id:"two",callsign:"VE1ABC",frequencyKHz:14023,contestPoints:2,contestMultiplierCount:1,
      contestCountryMultiplier:false,contestZoneMultiplier:true};
    const pointsPending={...needed,id:"points-pending",callsign:"W1PENDING",frequencyKHz:14023.5,contestPoints:null,contestMultiplierCount:1,
      contestCountryMultiplier:true,contestZoneMultiplier:false};
    const worked={...needed,id:"worked",callsign:"K1ABC",frequencyKHz:14024,contestPoints:0,contestDupe:true,contestMultiplierCount:0};
    const globalWorked={...needed,id:"global-worked",callsign:"F1ABC",frequencyKHz:14026,workedBefore:1,dxccStatus:"Worked"};
    expect(contestBandMapSpotColor(needed)).toBe("#3da5f4");expect(contestBandMapSpotColor(country)).toBe("#ff5267");
    expect(contestBandMapSpotColor(zone)).toBe("#ff5267");
    expect(contestBandMapSpotColor(double)).toBe("#00e51b");
    expect(contestBandMapSpotColor(twoPoint)).toBe("#ff5267");expect(contestBandMapSpotColor(worked)).toBe("#aeb5b7");
  expect(contestBandMapSpotColor({...needed,contestDupe:null,contestMultiplierCount:null,
    contestCountryMultiplier:null,contestZoneMultiplier:null})).toBe("#d9b56f");
    expect(contestBandMapSpotWorked(worked)).toBe(true);expect(contestBandMapSpotWorked(globalWorked)).toBe(false);
    const first=render(<BandMaps compact contestPresentation storageNamespace="contest" spots={[needed,country,zone,double,twoPoint,pointsPending,worked,globalWorked]} onSelect={vi.fn()} radioFrequencyHz={14_025_000}/>);
    const full=screen.getByRole("button",{name:/LONG\/CALLSIGN1/});expect(full.textContent).toBe("LONG/CALLSIGN1");
    expect(full.getAttribute("aria-label")).toContain("no needed multiplier · blue");
    expect(screen.getByRole("button",{name:/^VK1ABC /}).getAttribute("aria-label")).toContain("country multiplier · red");
    expect(screen.getByRole("button",{name:/^VK2ABC /}).getAttribute("aria-label")).toContain("CQ zone multiplier · red");
    expect(screen.getByRole("button",{name:/^JA1ABC /}).getAttribute("aria-label")).toContain("country and CQ zone multipliers · green");
    expect(screen.getByRole("button",{name:/^JA1ABC /}).textContent).toBe("JA1ABC");
    expect(screen.getByRole("button",{name:/^VK1ABC /}).textContent).toBe("VK1ABC");
    expect(screen.getByRole("button",{name:/^VK2ABC /}).textContent).toBe("VK2ABC");
    expect(screen.getByRole("button",{name:/^VE1ABC /}).getAttribute("aria-label")).toContain("2 pt · CQ zone multiplier · red");
    expect(screen.getByRole("button",{name:/^W1PENDING /}).getAttribute("aria-label")).toContain("Points unavailable · country multiplier · red");
    expect(screen.queryByRole("button",{name:/^K1ABC /})).toBeNull();expect(screen.getByRole("button",{name:/^F1ABC /})).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox",{name:"Show worked"}));
    expect(screen.getByRole("button",{name:/^K1ABC /})).toBeTruthy();
    expect(localStorage.getItem("xlog.integration.bandMaps.contest.showWorked")).toBe("true");
    first.unmount();
    render(<BandMaps compact contestPresentation storageNamespace="contest" spots={[needed,country,zone,double,twoPoint,worked,globalWorked]} onSelect={vi.fn()} radioFrequencyHz={14_025_000}/>);
    expect((screen.getByRole("checkbox",{name:"Show worked"}) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button",{name:/^K1ABC /})).toBeTruthy();
  });
  it("removes a newly logged duplicate immediately unless Show worked is enabled",()=>{
    const receivedAt=Date.now()/1000-978_307_200,base={...spot("stale",14215,"20m"),callsign:"LN8W",mode:"SSB",receivedAt,
      contestPoints:3,contestDupe:false,contestMultiplierCount:2,contestCountryMultiplier:true,contestZoneMultiplier:true},
      worked={...base,id:"worked",receivedAt:receivedAt-1,contestPoints:0,contestDupe:true,contestMultiplierCount:0,
        contestCountryMultiplier:false,contestZoneMultiplier:false};
    const view=render(<BandMaps compact contestPresentation storageNamespace="contest-post-log" contestBands={["20m"]}
      contestAllowedModes={["phone"]} spots={[base]} onSelect={vi.fn()} radioFrequencyHz={14_215_000}/>);
    expect(screen.getByRole("button",{name:/^LN8W /})).toBeTruthy();

    view.rerender(<BandMaps compact contestPresentation storageNamespace="contest-post-log" contestBands={["20m"]}
      contestAllowedModes={["phone"]} spots={[base,worked]} onSelect={vi.fn()} radioFrequencyHz={14_215_000}/>);
    expect(screen.queryByRole("button",{name:/^LN8W /})).toBeNull();

    fireEvent.click(screen.getByRole("checkbox",{name:"Show worked"}));
    const retained=screen.getByRole("button",{name:/^LN8W /});
    expect(retained.getAttribute("aria-label")).toContain("duplicate · grey");
    expect(retained.style.color).toBe("rgb(174, 181, 183)");
  });
  it("stacks nearby contest calls with leaders to their exact frequencies and preserves selection",()=>{
    const contestSpot=(id:string,callsign:string)=>({...spot(callsign,21258,"15m","New Call","New Country"),id,mode:"SSB",
      callsign,contestPoints:3,contestDupe:false,contestMultiplierCount:2,contestCountryMultiplier:true,contestZoneMultiplier:true}),
      marked={...contestSpot("a","IE9/DJ4EL"),marked:true};
    const select=vi.fn();
    const view=render(<BandMaps compact contestPresentation storageNamespace="contest-full-calls" contestBands={["15m"]}
      contestAllowedModes={["phone"]} spots={[marked,contestSpot("b","SM2/UT0CZ")]}
      onSelect={select} radioFrequencyHz={21_258_000}/>);
    const first=screen.getByRole("button",{name:/^IE9\/DJ4EL /}) as HTMLButtonElement,
      second=screen.getByRole("button",{name:/^SM2\/UT0CZ /}) as HTMLButtonElement;
    expect(first.textContent).toBe("IE9/DJ4EL");expect(second.textContent).toBe("SM2/UT0CZ");
    expect(first.getAttribute("aria-label")).toContain("Marked");
    expect(first.querySelector("b")).toBeNull();expect(second.querySelector("b")).toBeNull();
    expect(first.style.left).toBe(second.style.left);
    expect(Math.abs(parseFloat(first.style.top)-parseFloat(second.style.top))).toBeGreaterThanOrEqual(25);
    const leaders=Array.from(view.container.querySelectorAll<SVGPathElement>(".band-map-spot-leaders path"));
    expect(leaders).toHaveLength(2);
    for(const [button,id] of [[first,"a"],[second,"b"]] as const){
      const path=leaders.find(item=>item.dataset.spotId===id)!;
      expect(path.getAttribute("d")).toContain(`L ${parseFloat(button.style.left)-parseFloat(button.style.width)/2} ${parseFloat(button.style.top)}`);
    }
    expect(leaders[0].getAttribute("d")!.split(" L ")[0]).toBe(leaders[1].getAttribute("d")!.split(" L ")[0]);
    fireEvent.click(first);expect(select).toHaveBeenCalledWith(expect.objectContaining({id:"a"}));
    expect(first.getAttribute("aria-label")).toContain("country and CQ zone multipliers · green");
  });
  it("anchors crowded contest leaders to the full frequency scale even with an overflow notice",()=>{
    const spots=Array.from({length:30},(_,index)=>({...spot(`DL${index}A`,7110+index,"40m","New Call","New Country"),id:`c-${index}`}));
    const layout=placeSpots(spots,{low:7050,high:7200},240,100,1,90,true);
    expect(layout.hidden).toBeGreaterThan(0);
    for(const item of layout.placed)expect(item.anchorTop).toBeCloseTo((item.spot.frequencyKHz-7050)/150*100,8);
    expect(new Set(layout.placed.map(item=>`${item.lane}:${item.top}`)).size).toBe(layout.placed.length);
  });
  it("puts optional Undock immediately beside Add band map, preserves Dock back and removes redundant subtitle", () => {
    const undock = vi.fn(), dock = vi.fn(), select = vi.fn();
    render(<BandMaps spots={[]} onSelect={select} onUndock={undock} onDock={dock} />);
    const button = screen.getByRole("button", { name: "Undock" }), dockButton = screen.getByRole("button", { name: "Dock back" });
    expect(button.previousElementSibling?.contains(screen.getByLabelText("Add band map"))).toBe(true); expect(dockButton.previousElementSibling).toBe(button);
    expect(screen.queryByText("Click a spot to load it into the logger and request station tuning.")).toBeNull();
    fireEvent.click(button); fireEvent.click(dockButton); expect(undock).toHaveBeenCalledOnce(); expect(dock).toHaveBeenCalledOnce(); expect(select).not.toHaveBeenCalled();
  });
  it("uses an explicit compact toolbar slot while keeping standalone/full headers and page controls intact", () => {
    const target = document.createElement("div"); document.body.append(target);
    const preferences: BandMapViewPreferences = { bands: ["20m", "30m", "17m", "15m", "40m"], followRadio: false, layout: "row", fontScale: 1 };
    const { rerender, unmount } = render(<BandMapsToolbarContext.Provider value={target}><BandMaps compact spots={[]} onSelect={vi.fn()} preferences={preferences} /></BandMapsToolbarContext.Provider>);
    expect(screen.queryByRole("heading", { name: "Band maps" })).toBeNull();
    expect(target.contains(screen.getByRole("button", { name: "Next band maps" }))).toBe(true);
    expect(target.contains(screen.getByLabelText("Add band map"))).toBe(true); expect(target.contains(screen.getByRole("checkbox", { name: "Follow radio" }))).toBe(true);
    rerender(<BandMapsToolbarContext.Provider value={target}><BandMaps spots={[]} onSelect={vi.fn()} preferences={preferences} /></BandMapsToolbarContext.Provider>);
    expect(screen.getByRole("heading", { name: "Band maps" })).toBeTruthy(); expect(target.children).toHaveLength(0);
    unmount(); target.remove();
  });
  it("fills the available width and bounds pages to the available height", () => {
    expect(bandMapCapacity(1010, 700, true, 2)).toEqual({ columns: 2, capacity: 2 });
    expect(bandMapCapacity(600, 500, true, 8)).toEqual({ columns: 2, capacity: 2 });
    expect(bandMapCapacity(600, 500, false, 8)).toEqual({ columns: 2, capacity: 4 });
    expect(bandMapCapacity(260, 220, false, 8)).toEqual({ columns: 1, capacity: 1 });
  });

  it("pages excess bands without discarding zoom or tuning a spot", () => {
    const onSelect = vi.fn();
    const preferences: BandMapViewPreferences = { bands: ["20m", "30m", "17m", "15m", "40m"], followRadio: false, layout: "row", fontScale: 1 };
    render(<BandMaps spots={[]} onSelect={onSelect} preferences={preferences} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom 20m in" }));
    const zoomed = screen.getByLabelText(/20m spectrum/).getAttribute("aria-label");
    fireEvent.click(screen.getByRole("button", { name: "Next band maps" }));
    expect(screen.queryByRole("region", { name: "20m band map" })).toBeNull();
    expect(screen.getByRole("region", { name: "40m band map" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous band maps" }));
    expect(screen.getByLabelText(/20m spectrum/).getAttribute("aria-label")).toBe(zoomed);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reveals an added band on its page and retains prior zoom", () => {
    localStorage.setItem("xlog.integration.bandMaps.workspace.bands", JSON.stringify(["20m", "30m", "17m", "15m"]));
    localStorage.setItem("xlog.integration.bandMaps.workspace.layout", "row");
    render(<BandMaps spots={[]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom 20m in" }));
    const zoomed = screen.getByLabelText(/20m spectrum/).getAttribute("aria-label");
    fireEvent.change(screen.getByLabelText("Add band map"), { target: { value: "40m" } });
    expect(screen.getByRole("region", { name: "40m band map" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Previous band maps" }));
    expect(screen.getByLabelText(/20m spectrum/).getAttribute("aria-label")).toBe(zoomed);
  });

  it("does not let a second pointer clear drag click suppression", () => {
    class Pointer extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit) { super(type, init); this.pointerId = init.pointerId ?? 0; } }
    vi.stubGlobal("PointerEvent", Pointer);
    const onSelect = vi.fn();
    render(<BandMaps spots={[spot("DRAG2", 14170)]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom 20m in" }));
    const chart = screen.getByLabelText(/20m spectrum/) as HTMLElement;
    chart.setPointerCapture = vi.fn(); chart.hasPointerCapture = () => true; chart.releasePointerCapture = vi.fn();
    const marker = screen.getByRole("button", { name: /DRAG2.*MHz/ });
    fireEvent.pointerDown(marker, { pointerId: 1, button: 0, clientY: 100 });
    fireEvent.pointerMove(chart, { pointerId: 1, clientY: 130 });
    fireEvent.pointerDown(marker, { pointerId: 2, button: 0, clientY: 150 });
    fireEvent.pointerCancel(chart, { pointerId: 2 });
    fireEvent.pointerUp(chart, { pointerId: 1, clientY: 130 });
    fireEvent.click(marker, { detail: 1 });
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("combines mode choices, persists them, and clears to all without selecting a spot", () => {
    const onSelect = vi.fn();
    const spots = [spot("CW1", 14020), { ...spot("FT1", 14074), mode: "FT8" }, { ...spot("SSB1", 14200), mode: "SSB" }];
    const first = render(<BandMaps spots={spots} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Modes · All"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Data" }));
    expect(screen.getByText("2 of 3 spots")).toBeTruthy();
    expect(screen.getByText("Modes · CW + Phone")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /FT1.*MHz/ })).toBeNull();
    first.unmount();
    render(<BandMaps spots={spots} onSelect={onSelect} />);
    expect(screen.getByText("Modes · CW + Phone")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("3 of 3 spots")).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("pans a zoomed spectrum with wheel and clamps to its band boundaries", () => {
    const onSelect = vi.fn();
    render(<BandMaps spots={[]} onSelect={onSelect} />);
    const chart = screen.getByLabelText(/20m spectrum/) as HTMLElement;
    const initial = chart.getAttribute("aria-label");
    fireEvent.wheel(chart, { deltaY: 120 });
    expect(chart.getAttribute("aria-label")).toBe(initial);
    fireEvent.click(screen.getByRole("button", { name: "Zoom 20m in" }));
    const zoomed = chart.getAttribute("aria-label");
    fireEvent.wheel(chart, { deltaY: 120 });
    expect(chart.getAttribute("aria-label")).not.toBe(zoomed);
    expect(panBandRange({ low: 14100, high: 14200 }, BAND_RANGES["20m"], -1000)).toEqual({ low: 14000, high: 14100 });
    expect(panBandRange({ low: 14100, high: 14200 }, BAND_RANGES["20m"], 1000)).toEqual({ low: 14250, high: 14350 });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("drags the zoomed spectrum without accidentally tuning a spot", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const onSelect = vi.fn();
    render(<BandMaps spots={[spot("DRAG1", 14170)]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Zoom 20m in" }));
    const chart = screen.getByLabelText(/20m spectrum/) as HTMLElement;
    chart.setPointerCapture = vi.fn(); chart.hasPointerCapture = () => true; chart.releasePointerCapture = vi.fn();
    const marker = screen.getByRole("button", { name: /DRAG1.*MHz/ });
    const initial = chart.getAttribute("aria-label");
    fireEvent.pointerDown(marker, { button: 0, clientY: 100 });
    fireEvent.pointerMove(chart, { clientY: 140 });
    fireEvent.pointerUp(chart, { clientY: 140 });
    fireEvent.click(marker, { detail: 1 });
    expect(chart.getAttribute("aria-label")).not.toBe(initial);
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(marker, { button: 0, clientY: 100 });
    fireEvent.pointerUp(marker, { clientY: 100 });
    fireEvent.click(marker, { detail: 1 });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])("fits marker placement to resized chart height (compact=%s)", compact => {
    const resizes = new Map<Element, () => void>();
    vi.stubGlobal("ResizeObserver", class {
      callback: () => void;
      constructor(callback: () => void) { this.callback = callback; }
      observe(target: Element) { resizes.set(target, this.callback); }
      disconnect() {}
    });
    render(<BandMaps compact={compact} spots={[spot("OM0RX", 14001)]} onSelect={vi.fn()} />);
    const chart = screen.getByLabelText(/20m spectrum/) as HTMLElement;
    const resize = () => resizes.get(chart)?.();
    expect(chart.style.height).toBe("");
    Object.defineProperties(chart, { clientHeight: { value: 120, configurable: true }, clientWidth: { value: 310 } });
    act(() => resize());
    const marker = within(chart).getByRole("button", { name: /OM0RX/ });
    expect(parseFloat(marker.style.top)).toBeLessThan(120);
    Object.defineProperty(chart, "clientHeight", { value: 1000, configurable: true });
    act(() => resize());
    expect(parseFloat(marker.style.top)).toBeLessThan(100);
    Object.defineProperty(chart, "clientHeight", { value: 220 });
    act(() => resize());
    expect(parseFloat(marker.style.top)).toBeLessThan(220);
    expect(chart.style.height).toBe("");
  });

  it("keeps a manual zoom stable while the workspace is resized", () => {
    const resizes = new Map<Element, () => void>();
    vi.stubGlobal("ResizeObserver", class {
      callback: () => void;
      constructor(callback: () => void) { this.callback = callback; }
      observe(target: Element) { resizes.set(target, this.callback); }
      disconnect() {}
    });
    render(<BandMaps spots={[]} onSelect={vi.fn()} />);
    const chart = screen.getByLabelText(/20m spectrum/) as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: "Zoom 20m in" }));
    expect((screen.getByLabelText("Band map resolution") as HTMLSelectElement).value).toBe("custom");
    const zoomed = chart.getAttribute("aria-label");
    Object.defineProperties(chart, { clientHeight: { value: 680, configurable: true }, clientWidth: { value: 520, configurable: true } });
    act(() => resizes.get(chart)?.());
    expect(chart.getAttribute("aria-label")).toBe(zoomed);
  });

  it("uses native opportunity precedence and band boundaries", () => {
    expect(opportunityCode(spot("A", 14070, "20m", "New Call", "ATNO"))).toBe("ATNO");
    expect(opportunityCode(spot("B", 14070, "20m", "New Call"))).toBe("NC");
    expect(opportunityCode(spot("F", 14070, "20m", "New Call", "C/New Band"))).toBe("NB/C");
    expect(opportunityCode(spot("C", 14070, "20m", "Worked"))).toBe("W");
    expect(opportunityCode(spot("D", 14070, "20m", "Confirmed"))).toBe("C");
    expect(opportunityCode(spot("E", 14070, "20m", "Confirmed", "Worked"))).toBe("C");
    expect(opportunityCode(spot("G", 14070, "20m", "New Mode"))).toBe("NM");
    expect(opportunityCode(spot("H", 14070, "20m", "New Band"))).toBe("NB");
    expect(opportunityCode(spot("I", 14070, "20m", "New Band+Mode"))).toBe("NB+M");
    expect(opportunityCode(spot("J", 14070, "20m", "Worked", "W/New Band+Mode"))).toBe("NB+NM/W");
    expect(bandMapSpotColor({ ...spot("K", 14070), statusHex: "#123456" })).toBe("#123456");
    expect(bandMapSpotColor({ ...spot("L", 14070), statusHex: undefined })).toBe("#FF6B35");
    expect(bandForRadio(14_070_000)).toBe("20m");
    expect(bandForRadio(1)).toBeNull();
    expect(BAND_RANGES["30m"].allocations.map((part) => part.name)).toEqual(["CW", "Data"]);
  });

  it("uses compact common chip widths for visible callsigns and composite codes", () => {
    const spots = [spot("UB3A", 14020), spot("IU1PZC", 14030), spot("OK2JIQ/P", 14040), spot("R5GG", 14050, "20m", "New Call")];
    render(<BandMaps spots={spots} onSelect={vi.fn()} />);
    const chart = screen.getByLabelText(/20m spectrum/);
    const markers = within(chart).getAllByRole("button") as HTMLButtonElement[];
    const widths = markers.map(marker => parseFloat(marker.style.width));
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBeLessThan(90);
    expect(within(chart).getByText("OK2JIQ/P")).toBeTruthy();
    expect(within(chart).getAllByText("NC")).toHaveLength(4);
    expect(within(screen.getByRole("region", { name: "20m band map" })).getByText("Phone")).toBeTruthy();
  });

  it.each([0.8, 1, 2])("fits long calls and composite codes inside narrow lanes at scale %s", scale => {
    const short = [spot("UB3A", 14020)];
    const long = [spot("VK8/OK2JIQ/P", 14020, "20m", "New Call")];
    expect(bandMapSpotWidth(long, 400, scale)).toBeGreaterThan(bandMapSpotWidth(short, 400, scale));
    const available = bandMapLaneGeometry(105, scale).laneWidth - 5;
    expect(bandMapSpotWidth(long, available + 5, scale)).toBeLessThanOrEqual(available);
    expect(bandMapSpotWidth(long, 4, scale)).toBe(0);
    const crowded = Array.from({ length: 30 }, (_, index) => spot(`VK8/K${index}/P`, 14070));
    const result = placeSpots(crowded, { low: 14000, high: 14350 }, 310, 240, scale);
    expect(result.placed.length + result.hidden).toBe(crowded.length);
    expect(new Set(result.placed.map(({ lane, top }) => `${lane}:${top}`)).size).toBe(result.placed.length);
    expect(result.placed.every(({ lane }) => lane < bandMapLaneGeometry(310, scale).laneCount)).toBe(true);
  });

  it("keeps the frequency axis and crowded labels clear at 200% in a narrow chart", () => {
    const width = 289, height = 274, scale = 2;
    const geometry = bandMapLaneGeometry(width, scale);
    expect(geometry.axis).toBeGreaterThanOrEqual(6 * 9 * scale * 0.64 + 14);
    const crowded = Array.from({ length: 67 }, (_, index) => spot(`VK8/K${index}/P`, 14070));
    const result = placeSpots(crowded, { low: 14000, high: 14350 }, width, height, scale);
    const chipWidth = bandMapSpotWidth(crowded, geometry.laneWidth, scale);
    expect(result.hidden).toBeGreaterThan(0);
    for (const placed of result.placed) {
      const center = geometry.axis + geometry.laneWidth * (placed.lane + 0.5);
      expect(center - chipWidth / 2).toBeGreaterThan(geometry.axis);
      expect(center + chipWidth / 2).toBeLessThan(width);
      expect(placed.top - 22 * scale / 2).toBeGreaterThanOrEqual(0);
      expect(placed.top + 22 * scale / 2).toBeLessThanOrEqual(height - bandMapOverflowHeight(scale));
    }
    expect(result.placed.length + result.hidden).toBe(crowded.length);
    render(<BandMaps spots={crowded} onSelect={vi.fn()} preferences={{ bands: ["20m"], followRadio: false, layout: "grid", fontScale: scale }} />);
    const chart = screen.getByLabelText(/20m spectrum/);
    expect(chart.querySelectorAll(".band-map-allocation span").length).toBe(0);
    expect(within(screen.getByRole("region", { name: "20m band map" })).getByText("Phone")).toBeTruthy();
    expect(within(chart).getByRole("status").getAttribute("aria-label")).toContain("zoom in to separate labels");
  });

  it("retains normal chart capacity without an overflow notice and never places beyond a short chart", () => {
    const uncrowded = [spot("OM0RX", 14001)];
    expect(placeSpots(uncrowded, { low: 14000, high: 14350 }, 340, 520).placed[0].top).toBe(12.5);
    const tiny = placeSpots(uncrowded, { low: 14000, high: 14350 }, 289, 20, 2);
    expect(tiny.placed).toEqual([]); expect(tiny.hidden).toBe(1);
  });

  it("opens multiple real-data bands, preserves choices and protects the final panel", () => {
    const onSelect = vi.fn();
    const first = render(<BandMaps spots={[spot("OM0RX", 14070), spot("OH9W", 7186, "40m")]} onSelect={onSelect} />);
    expect(screen.getByRole("region", { name: "20m band map" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Add band map"), { target: { value: "40m" } });
    expect(screen.getByRole("region", { name: "40m band map" })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem("xlog.integration.bandMaps.workspace.bands") || "[]")).toEqual(["20m", "40m"]);
    fireEvent.click(screen.getByRole("button", { name: "Close 20m band map" }));
    expect(screen.queryByRole("region", { name: "20m band map" })).toBeNull();
    expect((screen.getByRole("button", { name: "Close 40m band map" }) as HTMLButtonElement).disabled).toBe(true);
    first.unmount();
    render(<BandMaps spots={[]} onSelect={onSelect} />);
    expect(screen.getByRole("region", { name: "40m band map" })).toBeTruthy();
  });

  it("follows an observed radio band and never tunes on its own", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<BandMaps compact spots={[spot("OH9W", 7186, "40m")]} onSelect={onSelect} radioFrequencyHz={14_100_000} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Follow radio" }));
    rerender(<BandMaps compact spots={[spot("OH9W", 7186, "40m")]} onSelect={onSelect} radioFrequencyHz={7_186_000} />);
    expect(screen.getByRole("region", { name: "40m band map" })).toBeTruthy();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("uses workspace-owned preferences without shadow-writing them and accepts restored values", () => {
    const onPreferencesChange = vi.fn();
    const base: BandMapViewPreferences = { bands: ["20m"], followRadio: true, layout: "grid", fontScale: 1 };
    const { rerender } = render(<BandMaps spots={[]} onSelect={vi.fn()} preferences={base} onPreferencesChange={onPreferencesChange} />);
    fireEvent.change(screen.getByLabelText("Add band map"), { target: { value: "40m" } });
    expect(onPreferencesChange).toHaveBeenLastCalledWith({ ...base, bands: ["20m", "40m"], followRadio: false });
    expect(localStorage.getItem("xlog.integration.bandMaps.workspace.bands")).toBeNull();
    expect(localStorage.getItem("xlog.integration.bandMaps.workspace.followRadio")).toBeNull();
    expect(localStorage.getItem("xlog.integration.bandMaps.workspace.layout")).toBeNull();
    expect(localStorage.getItem("xlog.integration.bandMaps.workspace.fontScale")).toBeNull();
    const restored: BandMapViewPreferences = { bands: ["17m"], followRadio: false, layout: "row", fontScale: 1.5 };
    rerender(<BandMaps spots={[]} onSelect={vi.fn()} preferences={restored} onPreferencesChange={onPreferencesChange} />);
    expect(screen.getByRole("region", { name: "17m band map" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "20m band map" })).toBeNull();
    expect(screen.getByRole("button", { name: "Single row" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("150%")).toBeTruthy();
    expect(localStorage.getItem("xlog.integration.bandMaps.workspace.bands")).toBeNull();
    expect(localStorage.getItem("xlog.integration.bandMaps.workspace.layout")).toBeNull();
  });

  it("restores the operator's resolution and age controls with controlled workspace preferences", () => {
    const preferences: BandMapViewPreferences = { bands: ["20m"], followRadio: false, layout: "grid", fontScale: 1 };
    const first = render(<BandMaps spots={[]} onSelect={vi.fn()} preferences={preferences} onPreferencesChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Band map resolution"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Spot age"), { target: { value: "45" } });
    first.unmount();
    render(<BandMaps spots={[]} onSelect={vi.fn()} preferences={preferences} onPreferencesChange={vi.fn()} />);
    expect((screen.getByLabelText("Band map resolution") as HTMLSelectElement).value).toBe("7");
    expect((screen.getByLabelText("Spot age") as HTMLSelectElement).value).toBe("45");
  });

  it("places an optional Dock back action beside Add band map only in a detached view", () => {
    const onDock = vi.fn();
    const { rerender } = render(<BandMaps spots={[]} onSelect={vi.fn()} onDock={onDock} />);
    const add = screen.getByLabelText("Add band map");
    const dock = screen.getByRole("button", { name: "Dock back" });
    expect(add.closest("label")?.nextElementSibling).toBe(dock);
    fireEvent.click(dock);
    expect(onDock).toHaveBeenCalledOnce();
    rerender(<BandMaps spots={[]} onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Dock back" })).toBeNull();
  });

  it("selects the original spot and keeps per-spot frequency in accessible detail only", () => {
    const onSelect = vi.fn();
    const realSpot = { ...spot("OM0RX", 14070), country: "SLOVAK REPUBLIC" };
    render(<BandMaps spots={[realSpot]} onSelect={onSelect} />);
    const panel = screen.getByRole("region", { name: "20m band map" });
    const marker = within(panel).getByRole("button", { name: /OM0RX.*14\.070\.0 MHz/ });
    expect(marker.getAttribute("aria-label")).toContain("Slovak Republic");
    expect(marker.textContent).toBe("OM0RXNC");
    fireEvent.click(marker);
    expect(onSelect).toHaveBeenCalledWith(realSpot);
    expect(within(panel).getByLabelText(/20m spectrum/)).toBeTruthy();
  });

  it("zooms, pans and restores allocation views without losing spots", () => {
    render(<BandMaps spots={[spot("OM0RX", 14070)]} onSelect={vi.fn()} />);
    const panel = screen.getByRole("region", { name: "20m band map" });
    fireEvent.change(within(panel).getByLabelText("20m allocation"), { target: { value: "CW portion" } });
    expect(within(panel).getByText("14.000.0–14.070.0 MHz")).toBeTruthy();
    fireEvent.click(within(panel).getByRole("button", { name: "Zoom 20m in" }));
    expect(within(panel).queryByText("14.000.0–14.070.0 MHz")).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Pan 20m higher" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Reset 20m range" }));
    expect(within(panel).getByText("14.000.0–14.350.0 MHz")).toBeTruthy();
  });

  it("places crowded labels in unique lanes and reports overflow", () => {
    const crowded = Array.from({ length: 30 }, (_, index) => spot(`K${index}`, 14070));
    const result = placeSpots(crowded, { low: 14000, high: 14350 }, 240, 100);
    expect(result.placed.length + result.hidden).toBe(30);
    const positions = result.placed.map(({ top, lane }) => `${lane}:${top}`);
    expect(new Set(positions).size).toBe(positions.length);
    expect(result.hidden).toBeGreaterThan(0);
  });
});
