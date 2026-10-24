// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Matrix, Rates } from "./ContestSecondaryPanels";

beforeEach(()=>localStorage.clear());
afterEach(()=>{cleanup();vi.useRealTimers();});
const spot={spotID:"vk",callsign:"VK2ABC",frequencyKHz:7125,mode:"SSB",contestDupe:false,
  contestMultiplierCount:2,contestCountryMultiplier:true,contestZoneMultiplier:true};
const matrix:any={schemaVersion:4,status:"ready",title:"DXCC",tracker:"dxcc",zoneSystem:null,
  current:{dxcc:null,cqZone:null,ituZone:null},bands:["20m","40m"],configuredBands:["40m"],currentBand:"40m",total:2,busy:false,
  rows:[{label:"Germany",continent:"EU",counts:{"20m":0,"40m":1},total:1},
    {label:"Australia",continent:"OC",counts:{"20m":0,"40m":0},total:0,availableSpots:{"40m":[spot]}},
    {label:"Japan",continent:"AS",counts:{"20m":1,"40m":0},total:1},
    {label:"Canada",continent:"NA",counts:{"20m":0,"40m":0},total:0,availableSpots:{"40m":[{...spot,spotID:"ve",callsign:"VE1XYZ",contestDupe:true}]}}]};

it("shows worked DXCC by default and filters the full expected list by needed, spotted-needed, band and continent",()=>{
  const selected=vi.fn(),mounted=render(<Matrix projection={matrix} preferenceScope="session" onSelectSpot={selected}/>);
  expect(screen.getByRole("combobox",{name:"Multiplier row filter"})).toHaveProperty("value","worked");
  expect(screen.getByRole("rowheader",{name:"Germany"})).toBeTruthy();
  expect(screen.queryByRole("rowheader",{name:"Australia"})).toBeNull();
  fireEvent.change(screen.getByLabelText("Multiplier row filter"),{target:{value:"needed"}});
  expect(screen.queryByRole("rowheader",{name:"Germany"})).toBeNull();
  expect(screen.getByRole("rowheader",{name:"Japan"})).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Multiplier row filter"),{target:{value:"spotted-needed"}});
  expect(screen.queryByRole("rowheader",{name:"Japan"})).toBeNull();
  expect(screen.queryByRole("rowheader",{name:"Canada"})).toBeNull();
  const candidate=screen.getByRole("button",{name:"Select VK2ABC for Australia on 40m"});
  expect(candidate.style.color).toBe("rgb(0, 229, 27)");fireEvent.click(candidate);expect(selected).toHaveBeenCalledWith("vk");
  fireEvent.change(screen.getByLabelText("Multiplier row filter"),{target:{value:"all"}});
  expect(screen.getAllByRole("rowheader")).toHaveLength(4);
  fireEvent.change(screen.getByLabelText("Multiplier continent"),{target:{value:"OC"}});
  expect(screen.getAllByRole("rowheader").map(row=>row.textContent)).toEqual(["Australia"]);
  mounted.unmount();render(<Matrix projection={matrix} preferenceScope="session" onSelectSpot={selected}/>);
  expect(screen.getByLabelText("Multiplier row filter")).toHaveProperty("value","all");
  expect(screen.getByLabelText("Multiplier continent")).toHaveProperty("value","OC");
});

it("preserves the full zone view and does not enable spot actions without draft authority",()=>{
  render(<Matrix projection={{...matrix,title:"CQ Zones",tracker:"zone",rows:[{label:"14",counts:{"20m":0,"40m":0},total:0,availableSpots:{"40m":[spot]}}]}} preferenceScope="session"/>);
  expect(screen.getByLabelText("Multiplier row filter")).toHaveProperty("value","all");
  expect(screen.getByRole("rowheader",{name:"14"})).toBeTruthy();
  expect(screen.getByRole("button",{name:"Select VK2ABC for 14 on 40m"})).toHaveProperty("disabled",true);
});

it("renders hourly counts, ticks time since the last QSO and remembers an optional hourly goal",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-25T02:03:04Z"));
  const rates:any={schemaVersion:1,status:"ready",lastHourQsoPerHour:20,last10QsoPerHour:60,last100QsoPerHour:null,
    sinceHourUTC:2,sinceHourQso:2,runQso:20,searchAndPounceQso:5,hourRunQso:2,hourSearchAndPounceQso:0,busy:false,
    hourly:[{hourUTC:"2026-10-25T00:00:00Z",qsos:10},{hourUTC:"2026-10-25T01:00:00Z",qsos:0},{hourUTC:"2026-10-25T02:00:00Z",qsos:2}],lastQsoAt:"2026-10-25T02:01:00Z"};
  const mounted=render(<Rates projection={rates} preferenceScope="contest"/>);
  expect(screen.getByLabelText("Time since last QSO").textContent).toContain("00:02:04");
  const graph=screen.getByRole("img",{name:"Hourly QSO graph"});
  expect([...graph.querySelectorAll("title")].map(item=>item.textContent)).toEqual(rates.hourly.map((item:any)=>`${item.hourUTC}: ${item.qsos} QSOs`));
  fireEvent.change(screen.getByLabelText("Hourly QSO goal"),{target:{value:"100"}});
  expect(screen.getByLabelText("Current hour goal progress").textContent).toBe("2 / 100");
  expect(graph.querySelector("line")).toBeTruthy();
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
  expect(screen.getByLabelText("Time since last QSO").textContent).toContain("00:02:05");
  mounted.unmount();render(<Rates projection={rates} preferenceScope="contest"/>);
  expect(screen.getByLabelText("Hourly QSO goal")).toHaveProperty("value","100");
  fireEvent.change(screen.getByLabelText("Hourly QSO goal"),{target:{value:""}});
  expect(screen.queryByLabelText("Current hour goal progress")).toBeNull();
});
