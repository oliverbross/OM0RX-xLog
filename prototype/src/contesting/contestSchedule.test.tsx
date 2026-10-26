// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { contestSchedule, contestUTC, qsoIdleColor } from "./contestSchedule";
import { Rates } from "./ContestSecondaryPanels";
import { ContestSetupPanel, newContestSetup } from "./ContestSetupPanel";
import { validContestSurfaceProjection, type ContestRatesSurfaceProjection } from "./contestSurfaceProtocol";

afterEach(()=>{cleanup();vi.useRealTimers();});
const start="2026-10-24T00:00:00.000Z",end="2026-10-26T00:00:00.000Z";
const rates:ContestRatesSurfaceProjection={schemaVersion:1,status:"ready",lastHourQsoPerHour:0,last10QsoPerHour:null,last100QsoPerHour:null,
  sinceHourUTC:0,sinceHourQso:0,runQso:0,searchAndPounceQso:0,hourRunQso:0,hourSearchAndPounceQso:0,busy:false,
  contestStartAt:start,contestEndAt:end,lastQsoAt:"2026-10-25T23:59:59.000Z"};

it("resolves CQ WW's full period and explicit ends for any plugin without timezone or DST shifts",()=>{
  expect(contestSchedule("cq_ww_ssb",{StartDate:"2026-10-24 00:00:00"})).toEqual({contestStartAt:start,contestEndAt:end});
  expect(contestSchedule("cq_ww_cw",{StartDate:"2026-10-24 00:00"}).contestEndAt).toBe(end);
  expect(contestSchedule("other",{StartDate:"2026-10-24 00:00",EndDate:"2026-10-24 12:00"}).contestEndAt).toBe("2026-10-24T12:00:00.000Z");
  expect(contestSchedule("other",{StartDate:"2026-10-24 00:00"}).contestEndAt).toBeNull();
  for(const EndDate of ["invalid","2026-02-30 00:00","2026-10-23 00:00","2026-10-24 00:00"])
    expect(contestSchedule("cq_ww_ssb",{StartDate:"2026-10-24 00:00",EndDate}).contestEndAt).toBeNull();
  expect(contestUTC("2026-02-30 00:00")).toBeNull();
});

it("ticks to zero, stays finished, resets idle color after a new QSO and keeps missing evidence neutral",()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-25T23:59:59Z"));
  const view=render(<Rates projection={rates}/>);
  expect(screen.getByLabelText("Contest time remaining").textContent).toContain("00:00:01");
  expect(screen.getByText("2026-10-26 00:00:00 UTC")).toBeTruthy();
  expect(screen.getByLabelText("Time since last QSO").style.color).toBe("rgb(18, 214, 160)");
  act(()=>vi.advanceTimersByTime(900_000));
  expect(screen.getByLabelText("Contest time remaining").textContent).toContain("00:00:00Finished");
  expect(screen.getByLabelText("Time since last QSO").style.color).toBe("rgb(255, 107, 94)");
  view.rerender(<Rates projection={{...rates,lastQsoAt:new Date().toISOString()}}/>);
  expect(screen.getByLabelText("Time since last QSO").style.color).toBe("rgb(18, 214, 160)");
  view.rerender(<Rates projection={{...rates,lastQsoAt:null,contestEndAt:null}}/>);
  expect(screen.getByLabelText("Time since last QSO").style.color).toBe("");
  expect(screen.getByLabelText("Contest time remaining").textContent).toContain("—");
  expect(qsoIdleColor(450)).toBe("rgb(243, 178, 60)");
});

it("shows full duration before the start instead of counting pre-contest waiting time",()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));render(<Rates projection={rates}/>);
  expect(screen.getByLabelText("Contest time remaining").textContent).toBe("48:00:00Not started");
});

it("validates schedule transport and remains compatible with old rate projections",()=>{
  expect(validContestSurfaceProjection("monitor",rates)).toBe(true);
  expect(validContestSurfaceProjection("monitor",{...rates,contestStartAt:undefined,contestEndAt:undefined})).toBe(true);
  for(const patch of [{contestStartAt:null},{contestEndAt:"bad"},{contestEndAt:start},{contestEndAt:"2026-02-30T00:00:00.000Z"}])
    expect(validContestSurfaceProjection("monitor",{...rates,...patch})).toBe(false);
});

it("edits, validates and reloads the saved UTC finish time",async()=>{
  const value=newContestSetup("OM0RX");value.station.CQZone="15";value.settings.StartDate="2026-10-24 00:00:00";
  const onSave=vi.fn(async()=>{}),props={value,activeSessionID:"test-session",catalog:[{id:value.pluginID,name:"CQ WW CW"}],sessions:[],onSave,onCreate:vi.fn(),onOpen:vi.fn()};
  const view=render(<ContestSetupPanel {...props}/>);fireEvent.click(screen.getByRole("button",{name:"Edit Current Contest"}));
  expect(screen.getByLabelText("End UTC")).toHaveProperty("value","2026-10-26T00:00");
  fireEvent.change(screen.getByLabelText("End UTC"),{target:{value:"2026-10-23T00:00"}});
  fireEvent.click(screen.getByRole("button",{name:"OK"}));
  await screen.findByText("End UTC must be a valid time after Start UTC.");expect(onSave).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("End UTC"),{target:{value:"2026-10-25T12:00"}});
  fireEvent.click(screen.getByRole("button",{name:"OK"}));await waitFor(()=>expect(onSave).toHaveBeenCalledOnce());
  const saved=(onSave.mock.calls[0] as unknown as [typeof value])[0];expect(saved.settings.EndDate).toBe("2026-10-25 12:00:00");
  view.unmount();render(<ContestSetupPanel {...props} value={saved}/>);fireEvent.click(screen.getByRole("button",{name:"Edit Current Contest"}));
  expect(screen.getByLabelText("End UTC")).toHaveProperty("value","2026-10-25T12:00");
});
