// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedContestDigitalDialog } from "./DetachedContestDigitalDialog";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args), isTauri: () => true }));
const snapshot = { epoch:"owner",context:"workspace/session",revision:1,
  document:{station:{},settings:{},preferences:{},network:{},macros:[]}, auxiliary:{roverLocation:"",diagnostics:{},
    digital:{configuration:{enabled:false,address:"224.0.0.1",port:2237},running:false,status:"Stopped",receive_only:true}}};
beforeEach(() => { invoke.mockReset(); invoke.mockImplementation(async (_command,{method,params}:any) => method === "snapshot" ? snapshot :
  method === "submit" ? {requestID:params.requestID,status:"saved"} : null); });
afterEach(cleanup);

it("shows the pinned Not1MM hierarchy without claiming fldigi integration", async () => {
  render(<DetachedContestDigitalDialog/>);
  expect(await screen.findByRole("heading",{name:"WSJT-X / JTDX"})).toBeTruthy();
  expect(screen.getByDisplayValue("224.0.0.1")).toBeTruthy(); expect(screen.getByDisplayValue("2237")).toBeTruthy();
  expect(screen.getByRole("heading",{name:"fldigi"})).toBeTruthy();
  expect(screen.getByText("Not integrated")).toBeTruthy(); expect(screen.getByText("CALL EXCHANGE")).toBeTruthy();
  expect(screen.getByText(/cannot claim a connection/)).toBeTruthy();
});

it("submits a bounded owner request and never invokes the worker directly", async () => {
  render(<DetachedContestDigitalDialog/>); await screen.findByDisplayValue("224.0.0.1");
  fireEvent.change(screen.getByLabelText("WSJT-X UDP address"),{target:{value:"127.0.0.1"}});
  fireEvent.click(screen.getByRole("button",{name:"Save and listen"}));
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("contest_setup_dialog_request",expect.objectContaining({method:"submit",
    params:expect.objectContaining({digital:{configuration:{enabled:false,address:"127.0.0.1",port:2237},action:"start"}})})));
  expect(invoke.mock.calls.every(([command]) => command === "contest_setup_dialog_request")).toBe(true);
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
    params:expect.objectContaining({digital:{configuration:snapshot.auxiliary.digital.configuration,action:"stop"}})})));
});
