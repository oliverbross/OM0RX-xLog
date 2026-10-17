// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TCIReceiveFilter, filterAdmission } from "./TCIReceiveFilter";
afterEach(() => { cleanup(); sessionStorage.clear(); vi.useRealTimers(); });
const stamp = Date.now()/1000;
const snapshot = { source:"direct_tci",available:true,generation:7,transport_state:"ready",generated_at:stamp,
  radio:{connected:true,observed:true,transmitting:false,observed_at:stamp},station:{radio_stale:false},
  capabilities:{supported_commands:["station_receive_filter"]},tci:{trx:1,channel:1,filter_scope:"trx",filter_lower_hz:-500,filter_upper_hz:500} };
function fixture(status="confirmed") {
  const request=vi.fn(async (p:Record<string,unknown>)=>({operation_id:p.operation_id as string,status,request:{action:"tci_receive_filter"}} as any));
  const transport={snapshot:vi.fn(async()=>({radio_id:"radio1" as const,active_radio:"radio1" as const,tx_owner:null,generation:"setup",revision:0,base_url:"",last_receipt:null,worker_generation:11,
    selection:{provider:"direct_tci",generation:2,selection_id:"saved",control_revision:3},
    radio:{provider:"direct_tci",selection_id:"saved",selection_generation:2,snapshot}})),request};
  render(<TCIReceiveFilter radioId="radio1" snapshot={snapshot} now={stamp*1000} transport={transport}/>);
  fireEvent.change(screen.getByLabelText("Lower edge (Hz)"),{target:{value:"30"}});
  fireEvent.change(screen.getByLabelText("Upper edge (Hz)"),{target:{value:"2700"}});
  return transport;
}
it("requires fresh READY transmit-off observed filter capability",()=>{
  expect(filterAdmission(snapshot,stamp*1000)).toBe(true);
  for (const change of [{available:false},{transport_state:"synchronizing"},{generated_at:stamp-6},{radio:{...snapshot.radio,transmitting:null}},
    {capabilities:{supported_commands:[]}},{tci:{...snapshot.tci,filter_scope:"channel"}}]) expect(filterAdmission({...snapshot,...change},stamp*1000)).toBe(false);
});
it("sends one fenced TRX-shared intent and confirms only a verified receipt",async()=>{
  const transport=fixture();
  expect(screen.getByText(/Shared by all channels on saved TRX 1/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Apply receive filter"}));
  await screen.findByText(/Receive filter confirmed/);
  expect(transport.request).toHaveBeenCalledTimes(1);
  expect(transport.request.mock.calls[0][0]).toMatchObject({action:"tci_receive_filter",provider:"direct_tci",lower_hz:30,upper_hz:2700,
    selection_id:"saved",selection_generation:2,control_revision:3,connection_generation:7,worker_generation:11});
  expect(transport.request.mock.calls[0][0]).not.toHaveProperty("trx");
});
it("retains unknown outcomes across remounts and checking never replays",async()=>{
  const transport=fixture("unknown");
  fireEvent.click(screen.getByRole("button",{name:"Apply receive filter"}));
  await screen.findByText(/Filter outcome unknown/);
  expect((screen.getByRole("button",{name:"Apply receive filter"}) as HTMLButtonElement).disabled).toBe(true);
  cleanup();render(<TCIReceiveFilter radioId="radio1" snapshot={snapshot} now={stamp*1000} transport={transport}/>);
  fireEvent.click(screen.getByRole("button",{name:"Check filter receipt"}));
  await screen.findByText(/Filter outcome remains unknown/);
  expect(transport.request.mock.calls.map(c=>c[0].action)).toEqual(["tci_receive_filter","receipt"]);
});
it("rejects decimals, reversed edges and address changes before dispatch",async()=>{
  const transport=fixture();
  fireEvent.change(screen.getByLabelText("Lower edge (Hz)"),{target:{value:"30.5"}});
  expect((screen.getByRole("button",{name:"Apply receive filter"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Lower edge (Hz)"),{target:{value:"2700"}});
  expect((screen.getByRole("button",{name:"Apply receive filter"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Lower edge (Hz)"),{target:{value:"30"}});
  transport.snapshot.mockResolvedValueOnce({...await transport.snapshot(),radio:{provider:"direct_tci",selection_id:"saved",selection_generation:2,snapshot:{...snapshot,generation:8}}});
  fireEvent.click(screen.getByRole("button",{name:"Apply receive filter"}));
  await waitFor(()=>expect(screen.getByText(/Refresh the selected TCI receiver/)).toBeTruthy());
  expect(transport.request).not.toHaveBeenCalled();
});
