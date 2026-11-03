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
function Harness({generation}:{generation?:string}){useNormalCommands(true,vi.fn(),generation);return null;}
beforeEach(()=>{vi.resetAllMocks();selectNormalBindingScope(undefined);setNormalBindings(undefined);reads=[];native.listen.mockResolvedValue(()=>{});native.invoke.mockImplementation(command=>{if(command!=="normal_command_preferences")return Promise.resolve();const read=deferred<any>();reads.push(read);return read.promise;});});
afterEach(cleanup);
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
