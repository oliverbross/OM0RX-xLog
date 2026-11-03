// @vitest-environment jsdom
import {describe,it,expect} from "vitest";
import {actionForEvent,bindingConflict,chordForEvent,checkedBindings,defaultNormalBindings,normalizeChord,setNormalBindings,editorCommand} from "./normalCommands";
const key=(key:string,overrides:Record<string,unknown>={})=>({key,code:"Key"+key,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,repeat:false,isComposing:false,getModifierState:()=>false,...overrides}) as unknown as KeyboardEvent;
describe("normal command admission",()=>{
 it("normalizes Mac and Windows/Linux primary modifiers without AltGr, dead keys, composition or repeat actions",()=>{
   expect(chordForEvent(key("j",{metaKey:true,shiftKey:true}),true)).toBe("Primary+Shift+J");
   expect(chordForEvent(key("j",{ctrlKey:true,shiftKey:true}),false)).toBe("Primary+Shift+J");
   for(const event of [key("j",{ctrlKey:true,altKey:true}),key("Dead",{ctrlKey:true}),key("j",{ctrlKey:true,isComposing:true}),key("j",{ctrlKey:true,getModifierState:()=>true})])expect(chordForEvent(event,false)).toBeNull();
   expect(chordForEvent(key("Enter",{code:"",metaKey:true}),true)).toBe("Primary+Enter");
   expect(chordForEvent(key("Enter",{code:"Enter",ctrlKey:true}),false)).toBe("Primary+Enter");
   expect(chordForEvent(key("Enter",{metaKey:true}),false)).toBeNull();
   expect(chordForEvent(key("Enter",{ctrlKey:true}),true)).toBeNull();
   expect(normalizeChord("Ctrl+Shift+j")).toBe("Primary+Shift+J");
   expect(actionForEvent(key("Enter",{ctrlKey:true,repeat:true}),defaultNormalBindings(),false)).toBeNull();
 });
 it("rejects native, lifecycle, editor and CW overlap while allowing modified normal chords",()=>{
   for(const chord of ["Primary+1","Primary+3","Primary+L","Primary+Q","Primary+W","Primary+C","Primary+Shift+K","Primary+Shift+R","Primary+F1","Escape"])
     expect(bindingConflict("open-world-map",chord,defaultNormalBindings())).toBeTruthy();
   const bindings={version:1 as const,overrides:{"open-world-map":"Primary+Shift+J"}};
   expect(bindingConflict("open-awards","Primary+Shift+J",bindings)).toContain("Already assigned");
   expect(bindingConflict("open-awards","Primary+Shift+U",bindings)).toBeNull();
 });
 it("preserves unavailable IDs and uses known defaults for malformed stored bindings",()=>{
   const result=checkedBindings({version:1,overrides:{"future-action":"Primary+Shift+U","save-current-qso":"Escape"}});
   expect(result.bindings.overrides["future-action"]).toBe("Primary+Shift+U");
   expect(result.bindings.overrides["save-current-qso"]).toBeUndefined();
   expect(result.warnings).toHaveLength(1);
   const future=checkedBindings({version:2,overrides:{"future-action":"Primary+Shift+U","save-current-qso":"Primary+Shift+J"}});
   expect(future.bindings.overrides).toEqual({"future-action":"Primary+Shift+U"});
   expect(future.warnings[0]).toContain("document version");
 });
 it("routes a remapped Save exactly once and consumes repeat without another save",()=>{
   setNormalBindings({version:1,overrides:{"save-current-qso":"Primary+Shift+U"}});
   let saves=0;
   const event=new KeyboardEvent("keydown",{key:"u",metaKey:/Mac/.test(navigator.platform),ctrlKey:!/Mac/.test(navigator.platform),shiftKey:true,cancelable:true});
   expect(editorCommand(event,{save:()=>saves++,focus:()=>{}})).toBe(true);
   expect(editorCommand(event,{save:()=>saves++,focus:()=>{}})).toBe(false);
   expect(saves).toBe(1);
   const repeat=new KeyboardEvent("keydown",{key:"u",metaKey:/Mac/.test(navigator.platform),ctrlKey:!/Mac/.test(navigator.platform),shiftKey:true,repeat:true,cancelable:true});
   expect(editorCommand(repeat,{save:()=>saves++,focus:()=>{}})).toBe(true);expect(repeat.defaultPrevented).toBe(true);expect(saves).toBe(1);
   document.documentElement.dataset.shortcutCapture="true";
   expect(editorCommand(new KeyboardEvent("keydown",{key:"u",ctrlKey:true,shiftKey:true}),{save:()=>saves++,focus:()=>{}})).toBe(false);
   document.documentElement.removeAttribute("data-shortcut-capture");setNormalBindings(undefined);
 });
});
