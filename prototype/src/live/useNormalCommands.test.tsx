// @vitest-environment jsdom
import {act,cleanup,render} from "@testing-library/react";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {useNormalCommands} from "./useNormalCommands";
import {bindingFor,currentNormalBindings,normalBindingContext,selectNormalBindingScope,setNormalBindings} from "./normalCommands";
const native=vi.hoisted(()=>({invoke:vi.fn(),listen:vi.fn()}));
vi.mock("@tauri-apps/api/core",()=>({invoke:native.invoke,isTauri:()=>true}));
vi.mock("@tauri-apps/api/event",()=>({listen:native.listen}));
const generationA="00000000-0000-4000-8000-000000000001",generationB="00000000-0000-4000-8000-000000000002";
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
let reads:ReturnType<typeof deferred<any>>[]=[];
const snapshot=(generation:string,revision:number,chord:string)=>({generation,revision,preferences:{normalCommandBindings:{version:1,overrides:{"open-awards":chord}}}});
function Harness({generation,scope="normal"}:{generation?:string;scope?:"normal"|"cw"}){useNormalCommands(true,vi.fn(),generation,scope);return null;}
beforeEach(()=>{vi.resetAllMocks();selectNormalBindingScope(undefined);setNormalBindings(undefined);reads=[];native.listen.mockResolvedValue(()=>{});native.invoke.mockImplementation(command=>{if(command!=="normal_command_preferences")return Promise.resolve();const read=deferred<any>();reads.push(read);return read.promise;});});
afterEach(()=>{cleanup();vi.restoreAllMocks();document.documentElement.removeAttribute("data-shortcut-capture");});
it("ignores an overlapping older focus read even when it returns last",async()=>{
 render(<Harness generation={generationA}/>);await act(async()=>{});
 act(()=>window.dispatchEvent(new Event("focus")));
 expect(reads).toHaveLength(2);
 await act(async()=>reads[1].resolve(snapshot(generationA,5,"Primary+Shift+J")));
 await act(async()=>reads[0].resolve(snapshot(generationA,4,"Primary+Shift+U")));
 expect(bindingFor("open-awards",currentNormalBindings())).toBe("Primary+Shift+J");
 expect(normalBindingContext()).toEqual({generation:generationA,revision:5});
});
it("cannot replace a newer saved revision with an in-flight lower revision read",async()=>{
 render(<Harness generation={generationA}/>);await act(async()=>{});
 setNormalBindings(snapshot(generationA,7,"Primary+Shift+J").preferences.normalCommandBindings,{generation:generationA,revision:7});
 await act(async()=>reads[0].resolve(snapshot(generationA,6,"Primary+Shift+U")));
 expect(bindingFor("open-awards",currentNormalBindings())).toBe("Primary+Shift+J");
});
it("invalidates pending old-workspace reads and rejects a mismatched generation after a switch",async()=>{
 const view=render(<Harness generation={generationA}/>);await act(async()=>{});
 view.rerender(<Harness generation={generationB}/>);await act(async()=>{});
 expect(bindingFor("open-awards",currentNormalBindings())).toBe("");
 await act(async()=>reads[1].resolve(snapshot(generationB,1,"Primary+Shift+J")));
 await act(async()=>reads[0].resolve(snapshot(generationA,99,"Primary+Shift+U")));
 expect(bindingFor("open-awards",currentNormalBindings())).toBe("Primary+Shift+J");
 act(()=>window.dispatchEvent(new Event("focus")));
 await act(async()=>reads[2].resolve(snapshot(generationA,100,"Primary+Shift+U")));
 expect(normalBindingContext()).toEqual({generation:generationB,revision:1});
 expect(setNormalBindings(snapshot(generationA,101,"Primary+Shift+U").preferences.normalCommandBindings,{generation:generationA,revision:101})).toBe(false);
});
it("does not install preferences before an authoritative workspace identity exists",async()=>{
 render(<Harness/>);await act(async()=>{});
 expect(reads).toHaveLength(0);
});
it("uses the same scoped command policy once for a detached CW intent and never executes capture, repeat or navigation",async()=>{
 vi.spyOn(document,"hasFocus").mockReturnValue(true);
 const send=vi.fn();window.addEventListener("xlog:cw-compose-send",send);
 render(<Harness generation={generationA} scope="cw"/>);await act(async()=>{});
 await act(async()=>reads[0].resolve({generation:generationA,revision:1,preferences:{normalCommandBindings:{version:1,overrides:{"cw-compose-send":"Primary+Shift+J","open-awards":"Primary+Shift+U"}}}}));
 const event=(key:string,extra:KeyboardEventInit={})=>new KeyboardEvent("keydown",{key,ctrlKey:!/Mac/.test(navigator.platform),metaKey:/Mac/.test(navigator.platform),shiftKey:true,bubbles:true,cancelable:true,...extra});
 const first=event("j");act(()=>{window.dispatchEvent(first);window.dispatchEvent(first);});expect(send).toHaveBeenCalledTimes(1);
 act(()=>{window.dispatchEvent(event("j",{repeat:true}));window.dispatchEvent(event("j",{isComposing:true}));window.dispatchEvent(event("u"));});
 document.documentElement.dataset.shortcutCapture="true";act(()=>window.dispatchEvent(event("j")));
 expect(send).toHaveBeenCalledTimes(1);expect(native.invoke.mock.calls.filter(([command])=>command==="normal_command_navigate")).toHaveLength(0);
 window.removeEventListener("xlog:cw-compose-send",send);
});
it("dispatches voice once and keeps Stop reachable when its desk is unmounted",async()=>{
 vi.spyOn(document,"hasFocus").mockReturnValue(true);
 const send=vi.fn(),stop=vi.fn();window.addEventListener("xlog:voice-send",send);window.addEventListener("xlog:voice-stop",stop);
 render(<Harness generation={generationA}/>);await act(async()=>{});
 await act(async()=>reads[0].resolve({generation:generationA,revision:1,preferences:{normalCommandBindings:{version:1,overrides:{"voice-send":"Primary+Shift+J","voice-stop":"Primary+Shift+U"}}}}));
 const event=(key:string,extra:KeyboardEventInit={})=>new KeyboardEvent("keydown",{key,ctrlKey:!/Mac/.test(navigator.platform),metaKey:/Mac/.test(navigator.platform),shiftKey:true,bubbles:true,cancelable:true,...extra});
 const first=event("j");act(()=>{window.dispatchEvent(first);window.dispatchEvent(first);window.dispatchEvent(event("j",{repeat:true}));window.dispatchEvent(event("j",{isComposing:true}));});
 expect(send).toHaveBeenCalledTimes(1);
 const desk=document.createElement("div");desk.className="voice-desk";document.body.append(desk);
 act(()=>window.dispatchEvent(event("u")));expect(stop).toHaveBeenCalledTimes(1);expect(native.invoke.mock.calls.filter(([command])=>command==="voice_request")).toHaveLength(0);
 desk.remove();await act(async()=>window.dispatchEvent(event("u")));
 expect(stop).toHaveBeenCalledTimes(1);expect(native.invoke.mock.calls.filter(([command])=>command==="voice_request")).toEqual([["voice_request",{params:{action:"stop"}}]]);
 document.documentElement.dataset.shortcutCapture="true";act(()=>window.dispatchEvent(event("j")));expect(send).toHaveBeenCalledTimes(1);
 window.removeEventListener("xlog:voice-send",send);window.removeEventListener("xlog:voice-stop",stop);
});
