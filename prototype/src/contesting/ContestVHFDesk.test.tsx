// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestVHFDesk } from "./ContestVHFDesk";
import type { ContestRequest } from "./types";
afterEach(cleanup);
const data={available:true,currentSiteID:"site-old",sites:[{id:"site-old",name:"Old hill",locator:"JN88XX",atUTC:"2026-10-21T00:00:00Z",note:"original",contacts:1,coordinate:[17.9,48.9]}],stationLocator:"JN88XX",locatorBasis:"explicit station site",coordinate:[17.9,48.9],
  beacons:[{id:"beacon",callsign:"DB0ABC",locator:"",frequencyHz:144450000,source:"dated fixture",observedUTC:"2020-01-01T00:00:00Z",ageSeconds:999999,status:"stale",worked:false,coordinate:null,distanceKm:null,headingDegrees:null}]};
const options=()=>({scope:{sessionID:"s",workspaceGeneration:"w",revision:4,draftID:"d",frequencyHz:10368000000,band:10000,selectedLaneID:"laneB",bindingVersion:2},disabled:false,
  request:vi.fn(async()=>({id:"read",ok:true,result:data})) as unknown as ContestRequest,onMutate:vi.fn(async()=>undefined),onTune:vi.fn(async()=>undefined),canMapTune:false});
it("shows historical site and dated unknown beacon without worked or tuning claims",async()=>{
  const props=options();render(<ContestVHFDesk {...props}/>);
  await screen.findByText(/Old hill · JN88XX/);expect(screen.getByRole("img",{name:"Station locator grid and unverified beacon overlay"})).toBeTruthy();
  fireEvent.click(screen.getByText("Dated beacon evidence"));
  expect(screen.getByText(/DB0ABC · locator unknown · stale/).textContent).toContain("distance unknown");
  expect(props.onTune).not.toHaveBeenCalled();expect(props.onMutate).not.toHaveBeenCalled();
});
it("saves explicit site and mapping intents without automatic tuning",async()=>{
  const props=options();render(<ContestVHFDesk {...props}/>);await screen.findByText(/Old hill · JN88XX/);
  fireEvent.change(screen.getByRole("textbox",{name:"Station site locator"}),{target:{value:"JO60AA"}});
  fireEvent.click(screen.getByRole("button",{name:"Activate explicit site for future contacts"}));
  await waitFor(()=>expect(props.onMutate).toHaveBeenCalledWith("site_activate",expect.objectContaining({locator:"JO60AA",siteID:expect.any(String)})));
  fireEvent.change(screen.getByRole("spinbutton",{name:"LO / offset (Hz)"}),{target:{value:"10224000000"}});
  fireEvent.click(screen.getByRole("button",{name:"Save lane-bound mapping"}));
  await waitFor(()=>expect(props.onMutate).toHaveBeenCalledWith("transverter_save",expect.objectContaining({laneID:"laneB",draftID:"d",bindingVersion:2,mapping:{band:"10000",loHz:10224000000,inverted:false,ifLowHz:140000000,ifHighHz:148000000}})));
  expect(props.onTune).not.toHaveBeenCalled();
});
