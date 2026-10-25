// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestRecorderWindow } from "./ContestRecorderWindow";
import type { RecorderRead, RecorderStatus } from "./contestRecorder";
afterEach(cleanup);
const stopped:RecorderStatus={context:{logId:"log",workspaceGeneration:"workspace"},config:null,root:"/private/fixture/Recordings",freeBytes:1e11,permission:"not requested",error:"",stationState:"Unknown — verify physical listening route",captures:[],selected:null,selection:null,active:null,playback:null};
describe("recorder operator controls",()=>{
  it("opening and polling cannot start capture, request permission or produce output",async()=>{
    const calls:Record<string,unknown>[]=[];const read:RecorderRead=async r=>{calls.push(r);return (r.action==="devices"?[]:stopped) as any;};
    render(<ContestRecorderWindow read={read}/>);await screen.findByText("not requested");
    expect(calls.every(r=>["devices","status"].includes(String(r.action)))).toBe(true);
    expect((screen.getByRole("button",{name:"Start / Resume"}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(window,{key:"Escape"});await waitFor(()=>expect(calls.at(-1)).toEqual({action:"stop_replay"}));
  });
  it("save has no implicit start and cancelled export is not reported complete",async()=>{
    const read=vi.fn().mockImplementation(async r=>r.action==="devices"?[]:r.action==="status"?stopped:{saved:true});
    render(<ContestRecorderWindow read={read}/>);await screen.findByText("not requested");
    fireEvent.click(screen.getByRole("button",{name:"Save settings"}));
    await screen.findByText("Settings saved; capture remains stopped");expect(read.mock.calls.some(([r])=>["start","replay","record_test"].includes(r.action))).toBe(false);
  });
});
