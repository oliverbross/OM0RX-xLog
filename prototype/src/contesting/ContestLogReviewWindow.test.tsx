// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContestLogReviewWindow } from "./ContestLogReviewWindow";
import { compareContestLog } from "./logReview";
import type { ReviewRead } from "./logReviewService";
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
