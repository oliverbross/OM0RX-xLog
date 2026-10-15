// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RadioReleaseStatus } from "./RadioReleaseStatus";
import { RadioReleaseSession, type ReleaseReceipt } from "./radioRelease";
afterEach(cleanup);
it("recovers a durable unknown after remount and reviews without sending a release", async () => {
  const id=crypto.randomUUID(), target={provider:"direct_agent" as const, selection_generation:1,selection_id:crypto.randomUUID(),worker_generation:3,connection_generation:2};
  let receipt: ReleaseReceipt={operation_id:id,target,status:"unknown"};
  const request=vi.fn(async (params: Record<string,unknown>): Promise<any> => {
    if(params.action==="snapshot") return {target,receipts:receipt.status === "unknown" ? [receipt] : []};
    if(params.action==="review") receipt={...receipt,status:"reviewed"};
    return receipt;
  });
  let ids:string[]=[];
  const journal={read:()=>ids,write:(next:string[])=>{ids=next;}};
  const session=new RadioReleaseSession(request,journal), first=render(<RadioReleaseStatus session={session}/>);
  await screen.findByRole("button",{name:"Check Cancel receipt"}); first.unmount();
  render(<RadioReleaseStatus session={new RadioReleaseSession(request,journal)}/>);
  fireEvent.click(await screen.findByRole("button",{name:"Check Cancel receipt"}));
  fireEvent.click(await screen.findByRole("button",{name:"I have reviewed observed radio state"}));
  await waitFor(()=>expect(screen.queryByRole("button",{name:"Check Cancel receipt"})).toBeNull());
  expect(request.mock.calls.every(([params])=>["snapshot","receipt","review"].includes(String(params.action)))).toBe(true);
});
