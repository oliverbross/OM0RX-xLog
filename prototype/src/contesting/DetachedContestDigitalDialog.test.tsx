// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedContestDigitalDialog } from "./DetachedContestDigitalDialog";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args), isTauri: () => true }));
const snapshot = { epoch:"owner",context:"workspace/session",revision:1,
  document:{station:{},settings:{},preferences:{},network:{},macros:[]}, auxiliary:{roverLocation:"",diagnostics:{},
    digital:{configuration:{enabled:false,address:"224.0.0.1",port:2237,destination:"ordinary_logbook"},running:false,status:"Stopped",receive_only:true,
      contest_target_supported:false,active_contest:null,fldigi:{configuration:{receive_enabled:false,transmit_enabled:false},receive_supported:false,
        transmit_supported:true,receive_running:false,status:"Off",udp_endpoint:"127.0.0.1:9876",xmlrpc_endpoint:"http://127.0.0.1:7362/RPC2"}}}};
beforeEach(() => { invoke.mockReset(); invoke.mockImplementation(async (_command,{method,params}:any) => method === "snapshot" ? snapshot :
  method === "submit" ? {requestID:params.requestID,status:"saved"} : null); });
afterEach(cleanup);

it("shows distinct original fldigi receive and transmit capabilities", async () => {
  render(<DetachedContestDigitalDialog/>);
  expect(await screen.findByRole("heading",{name:"WSJT-X / JTDX"})).toBeTruthy();
  expect(screen.getByDisplayValue("224.0.0.1")).toBeTruthy(); expect(screen.getByDisplayValue("2237")).toBeTruthy();
  expect(screen.getByRole("heading",{name:"fldigi"})).toBeTruthy();
  expect((screen.getByLabelText("Enable fldigi logged-QSO receive") as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText("Enable fldigi macro transmit") as HTMLInputElement).disabled).toBe(false);
  expect(screen.getByText("127.0.0.1:9876")).toBeTruthy(); expect(screen.getByText("http://127.0.0.1:7362/RPC2")).toBeTruthy();
  expect(screen.getByText(/choose the destination for accepted contacts/)).toBeTruthy();
  expect(screen.getByText(/saved to the selected destination/)).toBeTruthy();
  expect((screen.getByRole("option",{name:"Active contest"}) as HTMLOptionElement).disabled).toBe(true);
});

it("submits a bounded owner request and never invokes the worker directly", async () => {
  render(<DetachedContestDigitalDialog/>); await screen.findByDisplayValue("224.0.0.1");
  fireEvent.change(screen.getByLabelText("WSJT-X UDP address"),{target:{value:"127.0.0.1"}});
  fireEvent.click(screen.getByRole("button",{name:"Save and listen"}));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("contest_setup_dialog_request",expect.objectContaining({method:"submit",
    params:expect.objectContaining({digital:{configuration:{enabled:false,address:"127.0.0.1",port:2237,destination:"ordinary_logbook"},
      fldigi_configuration:{receive_enabled:false,transmit_enabled:false},action:"start"}})})));
  expect(invoke.mock.calls.every(([command]) => command === "contest_setup_dialog_request")).toBe(true);
});

it("offers the active contest only when the native route reports a real handler", async () => {
  invoke.mockImplementation(async (_command,{method,params}:any) => method === "snapshot" ? {
    ...snapshot, auxiliary:{...snapshot.auxiliary,digital:{...snapshot.auxiliary.digital,
      contest_target_supported:true,active_contest:{session_id:"contest",plugin_id:"cq_ww_rtty"}}}
  } : method === "submit" ? {requestID:params.requestID,status:"saved"} : null);
  render(<DetachedContestDigitalDialog/>); await screen.findByDisplayValue("224.0.0.1");
  const destination = screen.getByLabelText("WSJT-X logging destination") as HTMLSelectElement;
  expect((screen.getByRole("option",{name:"Active contest"}) as HTMLOptionElement).disabled).toBe(false);
  fireEvent.change(destination,{target:{value:"active_contest"}});
  fireEvent.click(screen.getByRole("button",{name:"Save and listen"}));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("contest_setup_dialog_request",expect.objectContaining({method:"submit",
    params:expect.objectContaining({digital:expect.objectContaining({configuration:expect.objectContaining({destination:"active_contest"})})})})));
});

it("keeps Stop available and submits the saved configuration when the draft is invalid", async () => {
  invoke.mockImplementation(async (_command,{method,params}:any) => method === "snapshot" ? {
    ...snapshot, auxiliary:{...snapshot.auxiliary,digital:{...snapshot.auxiliary.digital,running:true}}
  } : method === "submit" ? {requestID:params.requestID,status:"saved"} : null);
  render(<DetachedContestDigitalDialog/>); await screen.findByDisplayValue("224.0.0.1");
  fireEvent.change(screen.getByLabelText("WSJT-X UDP address"),{target:{value:"invalid"}});
  const stop = screen.getByRole("button",{name:"Stop listening"}) as HTMLButtonElement;
  expect(stop.disabled).toBe(false); fireEvent.click(stop);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("contest_setup_dialog_request", expect.objectContaining({method:"submit",
    params:expect.objectContaining({digital:expect.objectContaining({configuration:snapshot.auxiliary.digital.configuration,action:"stop"})})})));
});
