// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ManualTuneSession } from "./manualTune";
import { ManualSimplexTune } from "./ManualSimplexTune";
import type { StationReceipt, StationSession } from "./stationSession";
afterEach(cleanup);
function fixture() {
  let pending: string | null = null;
  const state: StationSession = { generation:"setup", revision:3, base_url:"", last_receipt:null, worker_generation:5,
    manual_tune_receipt:null,
    selection:{provider:"direct_flex_lan",generation:7,selection_id:"selection",control_revision:11},
    radio:{provider:"direct_flex_lan",selection_id:"selection",selection_generation:7,snapshot:{generation:13}} };
  const snapshot = vi.fn(async () => structuredClone(state));
  const request = vi.fn(async (params: Record<string, unknown>): Promise<StationReceipt | null> => ({ operation_id:params.operation_id as string,status:"confirmed",request:{action:"manual_tune"} }));
  const journal = { read:() => pending, write:(id: string | null) => { pending = id; } };
  const session = new ManualTuneSession({snapshot,request},journal);
  return { session,state,snapshot,request,journal,get pending() {return pending;} };
}
it("mounting a detached-ready manual tune control performs no action or poll", () => {
  const f=fixture(); render(<ManualSimplexTune provider="direct_flex_lan" session={f.session} />);
  expect(f.snapshot).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
});
it("binds one explicit tune to native epochs and journals before dispatch without changing a draft", async () => {
  const f=fixture(); f.request.mockImplementation(async params => {
    expect(f.pending).toBe(params.operation_id);
    expect(params).toMatchObject({action:"manual_tune",generation:"setup",revision:3,provider:"direct_flex_lan",selection_generation:7,selection_id:"selection",control_revision:11,
      connection_generation:13,worker_generation:5,frequency_hz:14074000,mode:"FT8"});
    return {operation_id:params.operation_id as string,status:"confirmed",request:{action:"manual_tune"}};
  });
  const before=structuredClone(f.state); await f.session.tune("direct_flex_lan",14074000,"FT8");
  expect(f.pending).toBeNull(); expect(f.request).toHaveBeenCalledOnce(); expect(f.state).toEqual(before);
});
it("two surfaces sharing the renderer session cannot dispatch duplicate concurrent tunes", async () => {
  const f=fixture(); let finish!: (r:StationReceipt)=>void;
  f.request.mockImplementation(() => new Promise(resolve=>{finish=resolve;}));
  const first=f.session.tune("direct_flex_lan",14074000,"USB"); await Promise.resolve();
  await expect(f.session.tune("direct_flex_lan",14074000,"USB")).rejects.toThrow(/existing manual tune/);
  finish({operation_id:f.pending!,status:"confirmed",request:{action:"manual_tune"}}); await first;
  expect(f.request).toHaveBeenCalledOnce();
});
it("a lost reply survives remount and receipt checks cannot retune", async () => {
  const f=fixture(); f.request.mockRejectedValueOnce(new Error("reply lost"));
  await expect(f.session.tune("direct_flex_lan",14074000,"USB")).rejects.toThrow("reply lost");
  const operation=f.pending!;
  const restored=new ManualTuneSession({snapshot:f.snapshot,request:f.request},f.journal);
  await expect(restored.tune("direct_flex_lan",14074000,"USB")).rejects.toThrow(/existing manual tune/);
  f.request.mockResolvedValue({operation_id:operation,status:"confirmed",request:{action:"manual_tune"}});
  await restored.check(); expect(f.request.mock.calls[1]).toEqual([{action:"receipt",operation_id:operation}]); expect(f.pending).toBeNull();
});
it("unknown, mismatched and merely acknowledged receipts retain the operation", async () => {
  for(const status of ["unknown","acknowledged"] as const) {
    const f=fixture(); f.request.mockImplementation(async p=>({operation_id:p.operation_id as string,status,request:{action:"manual_tune"}}));
    await expect(f.session.tune("direct_flex_lan",14074000,"USB")).rejects.toThrow(/outcome is unknown/); expect(f.pending).toBeTruthy();
    f.request.mockResolvedValue({operation_id:"wrong",status:"confirmed",request:{action:"manual_tune"}}); await expect(f.session.check()).rejects.toThrow(/does not match/); expect(f.pending).toBeTruthy();
  }
});
it("rejects another provider or invalid input before a command is dispatched", async () => {
  const f=fixture(); await expect(f.session.tune("hamlib",14074000,"USB")).rejects.toThrow(/selected radio/);
  await expect(f.session.tune("direct_flex_lan",14074000.5,"USB")).rejects.toThrow(/valid simplex/); expect(f.request).not.toHaveBeenCalled();
});
it("keeps local Hamlib tuning independent of the integration worker epoch", async () => {
  const f=fixture(); f.state.worker_generation=0; f.state.selection.provider="hamlib"; f.state.radio!.provider="hamlib";
  f.request.mockImplementation(async params => {
    expect(params.worker_generation).toBe(0);
    return {operation_id:params.operation_id as string,status:"confirmed",request:{action:"manual_tune"}};
  });
  await expect(f.session.tune("hamlib",7100000,"LSB")).resolves.toMatchObject({confirmed:true});
  expect(f.request).toHaveBeenCalledOnce();
});
it("binds an explicit TCI receive tune to the same durable native epochs", async () => {
  const f=fixture(); f.state.selection.provider="direct_tci"; f.state.radio!.provider="direct_tci";
  f.request.mockImplementation(async params => {
    expect(params).toMatchObject({provider:"direct_tci",connection_generation:13,worker_generation:5,frequency_hz:7100000,mode:"SSB"});
    return {operation_id:params.operation_id as string,status:"confirmed",request:{action:"manual_tune"}};
  });
  await expect(f.session.tune("direct_tci",7100000,"SSB")).resolves.toMatchObject({confirmed:true});
  expect(f.request).toHaveBeenCalledOnce();
});
it("standalone controls tune without a main renderer and expose read-only receipt recovery", async () => {
  const f=fixture(); render(<ManualSimplexTune provider="direct_flex_lan" session={f.session} />);
  fireEvent.change(screen.getByLabelText("Simplex frequency MHz"),{target:{value:"14.074000"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Tune simplex"}));});
  expect(f.request).toHaveBeenCalledOnce(); expect(screen.getByText(/confirmed by authoritative/)).toBeTruthy();
});
it("clears the initiating tune lost-reply error after terminal Check recovery",async()=>{
  const f=fixture();f.request.mockRejectedValueOnce(new Error("tune reply lost"));
  render(<ManualSimplexTune provider="direct_flex_lan" session={f.session}/>);
  fireEvent.change(screen.getByLabelText("Simplex frequency MHz"),{target:{value:"14.074000"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Tune simplex"}));});
  expect(screen.getByRole("alert").textContent).toContain("tune reply lost");const operation=f.pending!;
  f.request.mockResolvedValueOnce({operation_id:operation,status:"confirmed",request:{action:"manual_tune"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Check manual tune receipt"}));});
  expect(screen.queryByRole("alert")).toBeNull();expect(f.request).toHaveBeenCalledTimes(2);
});
it("clears the initiating tune unknown-outcome error after exact durable review",async()=>{
  const f=fixture();f.request.mockImplementationOnce(async p=>({operation_id:p.operation_id as string,status:"unknown",request:{action:"manual_tune"}}));
  render(<ManualSimplexTune provider="direct_flex_lan" session={f.session}/>);
  fireEvent.change(screen.getByLabelText("Simplex frequency MHz"),{target:{value:"14.074000"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Tune simplex"}));});
  expect(screen.getByRole("alert").textContent).toContain("outcome is unknown");const operation=f.pending!;
  f.request.mockResolvedValueOnce({operation_id:operation,status:"reviewed",request:{action:"manual_tune"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"I have reviewed observed radio state"}));});
  expect(screen.queryByRole("alert")).toBeNull();
});
it("reviewing a verified unknown never repeats it and permits only a new explicit request", async()=>{
  const f=fixture(); const session=new ManualTuneSession({snapshot:f.snapshot,request:f.request},f.journal);
  f.request.mockImplementation(async p=> p.action === "review"
    ? (f.state.manual_tune_receipt=null,{operation_id:p.operation_id as string,status:"reviewed",request:{action:"manual_tune"}})
    : ({operation_id:p.operation_id as string,status:p.frequency_hz === 7100000 ? "confirmed" : "unknown",request:{action:"manual_tune"}}));
  await expect(session.tune("direct_flex_lan",14074000,"USB")).rejects.toThrow(/unknown/);
  const operation=f.pending!;f.state.manual_tune_receipt={operation_id:operation,status:"unknown",request:{action:"manual_tune"}};
  await session.review();expect(f.pending).toBeNull();expect(f.request.mock.calls[1][0]).toEqual({action:"review",operation_id:operation,reviewed_action:"manual_tune"});
  await session.tune("direct_flex_lan",7100000,"LSB");expect(f.request).toHaveBeenCalledTimes(3);expect(f.request.mock.calls[2][0].operation_id).not.toBe(operation);
});
it("clears stale receipt and review errors after verified tune recovery",async()=>{
  const f=fixture();f.request.mockRejectedValueOnce(new Error("reply lost"));
  await expect(f.session.tune("direct_flex_lan",14074000,"USB")).rejects.toThrow("reply lost");const operation=f.pending!;
  render(<ManualSimplexTune provider="direct_flex_lan" session={f.session}/>);
  f.request.mockRejectedValueOnce(new Error("receipt unavailable"));
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Check manual tune receipt"}));});expect(screen.getByRole("alert").textContent).toContain("receipt unavailable");
  f.request.mockResolvedValueOnce({operation_id:operation,status:"unknown",request:{action:"manual_tune"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Check manual tune receipt"}));});expect(screen.queryByRole("alert")).toBeNull();
  f.request.mockRejectedValueOnce(new Error("review unavailable"));
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"I have reviewed observed radio state"}));});expect(screen.getByRole("alert").textContent).toContain("review unavailable");
  f.request.mockResolvedValueOnce({operation_id:operation,status:"reviewed",request:{action:"manual_tune"}});
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"I have reviewed observed radio state"}));});expect(screen.queryByRole("alert")).toBeNull();expect(f.pending).toBeNull();
});
it("recovers a lost durable tune-review acknowledgement without retuning",async()=>{
  const f=fixture();f.request.mockImplementation(async p=>({operation_id:p.operation_id as string,status:"unknown",request:{action:"manual_tune"}}));
  await expect(f.session.tune("direct_flex_lan",14074000,"USB")).rejects.toThrow(/unknown/);const operation=f.pending!;
  f.request.mockRejectedValueOnce(new Error("review reply lost"));await expect(f.session.review()).rejects.toThrow("review reply lost");
  f.request.mockResolvedValueOnce({operation_id:operation,status:"reviewed",request:{action:"manual_tune"}});
  await f.session.check();expect(f.pending).toBeNull();expect(f.request.mock.calls.at(-1)?.[0]).toEqual({action:"receipt",operation_id:operation});
});
