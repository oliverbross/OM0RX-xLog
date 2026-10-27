// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestQTC } from "./ContestQTC";
import type { ContestRequest } from "./types";
afterEach(cleanup);
const data={available:true,eligibility:null,ruleEdition:"DARC 2025-06-17",batches:[{id:"batch1",number:1,count:2,direction:"receive",counterpart:"K1ABC",timestamp:"2026-08-08 09:00:00",frequencyHz:14025000,status:"open",
  items:[{time:"0800",callsign:"DL1ABC",serial:"3",status:"confirmed",repeats:[]},{time:"0801",callsign:"DL2ABC",serial:"7",status:"pending",repeats:[]}]}],eligibleSources:[],score:{qtcPoints:1,total:4}};
const props=()=>({scope:{sessionID:"session",workspaceGeneration:"workspace",revision:6,draftID:"occupied",frequencyHz:14025000},disabled:false,
  request:vi.fn(async()=>({id:"read",ok:true,result:data})) as unknown as ContestRequest,onMutate:vi.fn(async()=>undefined),onEntry:vi.fn()});
it("keeps acknowledged items unavailable for resend and repeats only through explicit manual intent",async()=>{
  const options=props();render(<ContestQTC {...options}/>);
  expect(await screen.findByRole("button",{name:"Acknowledge item 1"})).toHaveProperty("disabled",true);
  expect(options.onMutate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Repeat serial 1"}));
  await waitFor(()=>expect(options.onMutate).toHaveBeenCalledWith("qtc_repeat",{batchID:"batch1",index:0,fields:"serial"}));
  fireEvent.click(screen.getByRole("button",{name:"Return to Entry"}));expect(options.onEntry).toHaveBeenCalledOnce();
});
it("creates pending received items without changing or clearing the entry draft",async()=>{
  const options=props();render(<><input aria-label="Preserved caller" defaultValue="K9DRAFT"/><ContestQTC {...options}/></>);
  await screen.findByText(/shared score 4/);
  fireEvent.change(screen.getByRole("textbox",{name:"QTC counterpart"}),{target:{value:"K1ABC"}});
  fireEvent.change(screen.getByRole("textbox",{name:"Received QTC items"}),{target:{value:"0800 DL1ABC 3\n0801 DL2ABC 7"}});
  fireEvent.click(screen.getByRole("button",{name:"Create pending QTC series"}));
  await waitFor(()=>expect(options.onMutate).toHaveBeenCalledWith("qtc_create",expect.objectContaining({counterpart:"K1ABC",items:[{time:"0800",callsign:"DL1ABC",serial:"3"},{time:"0801",callsign:"DL2ABC",serial:"7"}]})));
  expect(screen.getByRole("textbox",{name:"Preserved caller"})).toHaveProperty("value","K9DRAFT");
});
