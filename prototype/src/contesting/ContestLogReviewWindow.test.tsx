// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContestLogReviewWindow } from "./ContestLogReviewWindow";
import { compareContestLog } from "./logReview";
import type { ReviewRead } from "./logReviewService";
const native=vi.hoisted(()=>({invoke:vi.fn(async()=>{})}));
vi.mock("@tauri-apps/api/core",()=>({invoke:native.invoke}));
afterEach(()=>{cleanup();localStorage.clear();});
function fixture(){
  const row={ID:"one",Call:"DL3AJ",TS:"2026-10-24 00:01:00",Freq:7150,Mode:"SSB"};
  const context={sessionID:"session",workspaceGeneration:"workspace",revision:7,total:1,rows:[row]};
  const observation={id:"spot",callsign:"DL3AG",spotter:"OM0RX",frequencyKHz:7150,band:"40m",mode:"SSB",
    reportedAt:"2026-10-24T00:00:00Z",arrivedAt:"2026-10-24T00:00:01Z",recordKind:"live",source:"cluster",comment:"CQ",clusterName:"Test"};
  const read=vi.fn<ReviewRead>(async(method)=>method==="context"||method==="contest_log_page"?context:
    method==="spot_history_status"?{status:{total:1,earliest:null,latest:null},recording:{state:"recording",queued:0,unrecorded:0}}:
    method==="spot_history_detail"?{observation:{...observation,rawLine:"DX de OM0RX: 7150 DL3AG CQ"}}:
    method==="reference_log_review"?{sources:[],rows:[{id:row.ID,call:row.Call,lotwListed:null,countries:[]}]}:
    {page:{rows:[observation],watermark:1,nextCursor:null}});
  const compare=vi.fn(async(snapshot,options)=>compareContestLog(snapshot.qsos,snapshot.spots,options,snapshot.references));
  return {read,compare};
}
describe("Log Review window",()=>{
  it("opens the exact flagged ID and applies only the explicit callsign correction, once per snapshot",async()=>{
    native.invoke.mockClear();const {read,compare}=fixture();
    render(<ContestLogReviewWindow read={read} compare={compare}/>);
    fireEvent.click(screen.getByRole("button",{name:"Run review"}));
    fireEvent.click(await screen.findByRole("button",{name:"DL3AJ"}));
    expect(screen.getByRole("table",{name:"Logged contact compared with reports"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Open Log Display"}));
    expect(native.invoke).toHaveBeenCalledWith("contest_log_review_open_log",{sessionId:"session",workspaceGeneration:"workspace",qsoId:"one",callsign:"DL3AJ"});
    fireEvent.click(screen.getByRole("button",{name:"Change callsign to DL3AG"}));
    await screen.findByText(/Callsign changed: DL3AJ → DL3AG/);
    expect(native.invoke).toHaveBeenCalledWith("contest_log_review_correct_call",{sessionId:"session",workspaceGeneration:"workspace",qsoId:"one",
      expectedRevision:7,expectedCall:"DL3AJ",callsign:"DL3AG",requestId:expect.any(String)});
    expect((screen.getByRole("button",{name:"Change callsign to DL3AG"}) as HTMLButtonElement).disabled).toBe(true);
  });
  it("keeps a failed or uncertain correction disabled until a fresh review",async()=>{
    native.invoke.mockRejectedValueOnce(new Error("Action still pending. Run review again."));const {read,compare}=fixture();
    render(<ContestLogReviewWindow read={read} compare={compare}/>);
    fireEvent.click(screen.getByRole("button",{name:"Run review"}));fireEvent.click(await screen.findByRole("button",{name:"DL3AJ"}));
    fireEvent.click(screen.getByRole("button",{name:"Change callsign to DL3AG"}));
    expect((await screen.findByRole("alert")).textContent).toContain("pending");
    expect((screen.getByRole("button",{name:"Change callsign to DL3AG"}) as HTMLButtonElement).disabled).toBe(true);
  });
  it("does no work until Run review; shows evidence and persists a review decision without editing",async()=>{
    const {read,compare}=fixture();render(<ContestLogReviewWindow read={read} compare={compare}/>);
    expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button",{name:"Run review"}));
    fireEvent.click(await screen.findByRole("button",{name:"DL3AJ"}));
    expect(screen.getByRole("complementary",{name:"Supporting reports"})).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Original report"}));
    expect(await screen.findByText("DX de OM0RX: 7150 DL3AG CQ")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Keep logged contact"}));
    fireEvent.change(screen.getByLabelText("Show"),{target:{value:"Reviewed"}});
    expect(screen.getByRole("button",{name:"DL3AJ"})).toBeTruthy();
    expect(read.mock.calls.every(([method])=>["context","contest_log_page","spot_history_status","spot_history_query","spot_history_detail","reference_log_review"].includes(method))).toBe(true);
    expect(localStorage.length).toBe(1);
  });
  it("keeps all failures inside the review window and allows retry",async()=>{
    const read=vi.fn<ReviewRead>().mockRejectedValue(new Error("No contest session is active."));
    render(<ContestLogReviewWindow read={read}/>);
    fireEvent.click(screen.getByRole("button",{name:"Run review"}));
    await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("No contest session"));
    expect((screen.getByRole("button",{name:"Run review"}) as HTMLButtonElement).disabled).toBe(false);
  });
});
