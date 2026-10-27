// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {ContestIntegrationDelivery} from "./ContestIntegrationDelivery";
import type {ContestRequest} from "./types";

const scope={sessionID:"session-a",workspaceGeneration:"workspace-a"};
const row={id:"delivery-a",kind:"contactreplace",destination:"127.0.0.1:12061",qso_id:"qso-a",sha256:"a".repeat(64),
  outcome:"sent_unverified",error:"",attempts:1,updated_utc:"2026-10-27 00:00:00"};
const result={rows:[row],remotePersistenceVerified:false,retryPolicy:"Review the consumer"};
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe("optional integration delivery",()=>{
  it("requires a fresh explicit uncertainty confirmation and sends the reviewed hash/attempt",async()=>{
    const confirm=vi.spyOn(window,"confirm").mockReturnValue(false);
    const request=vi.fn(async()=>({id:"read",ok:true as const,result}));
    render(<ContestIntegrationDelivery scope={scope} request={request as ContestRequest} disabled={false}/>);
    const button=await screen.findByRole("button",{name:"Review retry contactreplace"});
    expect(screen.getByText("Sent · remote result unverified")).toBeTruthy();
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);expect(confirm).not.toHaveBeenCalled();expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("checkbox",{name:/I reviewed the consumer/}));fireEvent.click(button);
    await waitFor(()=>expect(request).toHaveBeenCalledWith("contest_n1mm_retry",{...scope,deliveryID:row.id,sha256:row.sha256,expectedAttempts:1,confirmUncertain:true}));
  });
  it("cannot paint an old session's delayed retry onto the new session",async()=>{
    vi.spyOn(window,"confirm").mockReturnValue(true);
    let finish:(value:unknown)=>void=()=>{};
    const request=vi.fn((method:string,params:any)=>method==="contest_n1mm_retry"?new Promise(resolve=>{finish=resolve;}):
      Promise.resolve({ok:true,result:params.sessionID===scope.sessionID?result:{...result,rows:[]}}));
    const view=render(<ContestIntegrationDelivery scope={scope} request={request as ContestRequest} disabled={false}/>);
    await screen.findByRole("button",{name:"Review retry contactreplace"});
    fireEvent.click(screen.getByRole("checkbox",{name:/I reviewed the consumer/}));
    fireEvent.click(screen.getByRole("button",{name:"Review retry contactreplace"}));
    view.rerender(<ContestIntegrationDelivery scope={{sessionID:"session-b",workspaceGeneration:"workspace-b"}} request={request as ContestRequest} disabled={false}/>);
    await screen.findByText("No optional datagram attempts are recorded for this session.");
    await act(async()=>finish({ok:true,result}));
    expect(screen.queryByRole("button",{name:"Review retry contactreplace"})).toBeNull();
  });
});
