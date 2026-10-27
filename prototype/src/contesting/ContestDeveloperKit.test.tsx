// @vitest-environment jsdom
import { afterEach,expect,it,vi } from "vitest";
import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { ContestDeveloperKit } from "./ContestDeveloperKit";
import type { ContestRequest } from "./types";
afterEach(cleanup);
it("reviews finite template metadata and rejects UDC without sending a mutation or output",async()=>{
  const request=vi.fn(async(_method:string,params:Record<string,unknown>)=>({id:"read",ok:true,result:params.udcText?{
    converted:false,executed:false,installed:false,original:{content:params.udcText},diagnostics:[{key:"QTC",status:"unsupported"}]
  }:{templateID:params.templateID,readiness:{newDefinition:"UNVERIFIED"}}}));
  render(<ContestDeveloperKit scope={{sessionID:"s",workspaceGeneration:"w",revision:2}} request={request as unknown as ContestRequest}/>);
  fireEvent.click(screen.getByRole("button",{name:"Review Python template manifest"}));
  await screen.findByText("Bundled reference example; no new definition is installed.");
  fireEvent.click(screen.getByText("Unsupported UDC inspection"));
  const raw="QTC={TX}\nDynamicExchange=execute()";
  fireEvent.change(screen.getByRole("textbox",{name:"Original UDC text"}),{target:{value:raw}});
  fireEvent.click(screen.getByRole("button",{name:"Inspect without executing or installing"}));
  await screen.findByText("Conversion rejected; original input retained in this diagnostic.");
  await waitFor(()=>expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls.every(([method,params])=>method==="contest_strategy"&&params.section==="developer"&&params.expectedRevision===2)).toBe(true);
  expect(screen.getByRole("textbox",{name:"Original UDC text"})).toHaveProperty("value",raw);
});
