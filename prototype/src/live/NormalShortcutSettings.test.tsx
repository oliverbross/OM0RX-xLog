// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,within,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {NormalShortcutSettings} from "./NormalShortcutSettings";
const native=vi.hoisted(()=>({invoke:vi.fn(),worker:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:native.invoke}));
vi.mock("../worker",()=>({workerRequest:native.worker}));
const initial=()=>({generation:"00000000-0000-4000-8000-000000000001",revision:3,preferences:{normalCommandBindings:{version:1,overrides:{"future-command":"Primary+Shift+U"}}}});
beforeEach(()=>{vi.resetAllMocks();native.invoke.mockImplementation(async(_command,params)=>({active:params.active,requestId:params.requestId}));native.worker.mockImplementation(async(method,params)=>({ok:true,result:method==="workspace_preferences_load"?initial():{...initial(),revision:4,status:"applied",preferences:{normalCommandBindings:params.bindings}}}));});
afterEach(cleanup);
it("captures without executing Save, rejects collisions, and persists only explicit typed bindings",async()=>{
 render(<NormalShortcutSettings/>);
 const capture=await screen.findByLabelText("Capture Save current QSO");
 await act(async()=>{});
 fireEvent.click(screen.getByRole("button",{name:"Start capture Save current QSO"}));await waitFor(()=>expect((capture as HTMLInputElement).disabled).toBe(false));fireEvent.keyDown(capture,{key:"j",ctrlKey:true,shiftKey:true});
 expect(native.worker.mock.calls).toEqual([["workspace_preferences_load"]]);
 expect(native.invoke.mock.calls.every(([command])=>command==="normal_shortcut_capture")).toBe(true);
 fireEvent.blur(capture);fireEvent.click(screen.getByRole("button",{name:"Save shortcuts"}));await act(async()=>{});
 expect(native.worker).toHaveBeenLastCalledWith("workspace_commands_apply",{generation:initial().generation,expectedRevision:3,bindings:{version:1,overrides:{"future-command":"Primary+Shift+U","save-current-qso":"Primary+Shift+J"}}});
 expect(await screen.findByRole("status")).toHaveProperty("textContent","Shortcuts saved. Other windows reload on focus.");
 const other=screen.getByLabelText("Capture Open Awards");fireEvent.click(screen.getByRole("button",{name:"Start capture Open Awards"}));await waitFor(()=>expect((other as HTMLInputElement).disabled).toBe(false));fireEvent.keyDown(other,{key:"j",ctrlKey:true,shiftKey:true});
 expect(await screen.findByRole("alert")).toHaveProperty("textContent",expect.stringContaining("Already assigned"));
});
it("keeps attempted edits visible after a concurrent revision conflict and preserves unavailable actions on reset",async()=>{
 const original=native.worker.getMockImplementation()!;
 native.worker.mockImplementation(async(method,params)=>method==="workspace_commands_apply"?{ok:true,result:{...initial(),revision:4,status:"conflict"}}:original(method,params));
 render(<NormalShortcutSettings/>);const capture=await screen.findByLabelText("Capture Save current QSO");await act(async()=>{});
 fireEvent.click(screen.getByRole("button",{name:"Start capture Save current QSO"}));await waitFor(()=>expect((capture as HTMLInputElement).disabled).toBe(false));fireEvent.keyDown(capture,{key:"j",ctrlKey:true,shiftKey:true});fireEvent.blur(capture);
 fireEvent.click(screen.getByRole("button",{name:"Save shortcuts"}));await act(async()=>{});
 expect(await screen.findByRole("alert")).toHaveProperty("textContent",expect.stringContaining("attempted shortcuts are retained"));
 const row=screen.getByText("Save current QSO").closest("tr")!;expect(within(row).getByText("Ctrl + Shift + J")).toBeTruthy();
 fireEvent.click(screen.getByRole("button",{name:"Reset all supported actions"}));
 expect(screen.getByText(/Unavailable actions preserved/)).toHaveProperty("textContent",expect.stringContaining("future-command"));
});

const deferred=<T,>()=>{let resolve!:(value:T)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<T>((done,failed)=>{resolve=done;reject=failed;});return {promise,resolve,reject};};
it("keeps recording disabled until the exact native guard request is acknowledged",async()=>{
 const held=deferred<{active:boolean;requestId:string}>();native.invoke.mockImplementation((_command,params)=>params.active?held.promise:Promise.resolve({active:false,requestId:params.requestId}));
 render(<NormalShortcutSettings/>);const input=await screen.findByLabelText("Capture Save current QSO");await act(async()=>{});
 fireEvent.click(screen.getByRole("button",{name:"Start capture Save current QSO"}));
 expect((input as HTMLInputElement).disabled).toBe(true);
 fireEvent.keyDown(input,{key:"j",ctrlKey:true,shiftKey:true});
 expect(screen.getByText("Preparing native capture — wait for confirmation.")).toBeTruthy();
 await act(async()=>{});
 const params=native.invoke.mock.calls.find(([,params])=>params.active)![1];
 await act(async()=>{held.resolve({active:true,requestId:params.requestId});});
 expect((input as HTMLInputElement).disabled).toBe(false);
 fireEvent.keyDown(input,{key:"j",ctrlKey:true,shiftKey:true});
 expect(within(screen.getByText("Save current QSO").closest("tr")!).getByText("Ctrl + Shift + J")).toBeTruthy();
});
it.each(["failed","wrong acknowledgement"])("never enters recording after a %s native guard",async(kind)=>{
 native.invoke.mockImplementation((_command,params)=>params.active?(kind==="failed"?Promise.reject(new Error("Native guard unavailable")):Promise.resolve({active:true,requestId:"wrong-request"})):Promise.resolve({active:false,requestId:params.requestId}));
 render(<NormalShortcutSettings/>);const input=await screen.findByLabelText("Capture Save current QSO");await act(async()=>{});
 fireEvent.click(screen.getByRole("button",{name:"Start capture Save current QSO"}));await act(async()=>{});
 expect((input as HTMLInputElement).disabled).toBe(true);
 expect(await screen.findByRole("alert")).toHaveProperty("textContent",expect.stringMatching(/Native guard unavailable|acknowledgement could not be verified/));
 fireEvent.keyDown(input,{key:"j",ctrlKey:true,shiftKey:true});
 expect(within(screen.getByText("Save current QSO").closest("tr")!).getAllByRole("cell")[0].textContent).toBe("Ctrl + Enter");
 expect(native.worker.mock.calls).toEqual([["workspace_preferences_load"]]);
});
it("serializes release after a pending begin and ignores its late acknowledgement after blur",async()=>{
 const held=deferred<{active:boolean;requestId:string}>();native.invoke.mockImplementation((_command,params)=>params.active?held.promise:Promise.resolve({active:false,requestId:params.requestId}));
 render(<NormalShortcutSettings/>);const input=await screen.findByLabelText("Capture Save current QSO");await act(async()=>{});
 const button=screen.getByRole("button",{name:"Start capture Save current QSO"});fireEvent.click(button);await act(async()=>{});
 const params=native.invoke.mock.calls[0][1];fireEvent.blur(button);
 expect(native.invoke).toHaveBeenCalledTimes(1);
 await act(async()=>{held.resolve({active:true,requestId:params.requestId});});
 expect((input as HTMLInputElement).disabled).toBe(true);
 expect(native.invoke.mock.calls.map(([,params])=>params.active)).toEqual([true,false]);
 expect(document.documentElement.dataset.shortcutCapture).toBeUndefined();
});
