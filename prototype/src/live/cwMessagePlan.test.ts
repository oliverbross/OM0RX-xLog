import {describe,expect,it} from "vitest";
import {compileCWMessage,compositionBoundary,describeCWPlan} from "./cwMessagePlan";

describe("shared typed CW preview and deliberate composition boundaries",()=>{
  it("retains portable calls, serial and typed operations using hand-checked expected plan",()=>{
    const plan=compileCWMessage(" {CALL} {WPM:18}5NN {SERIAL}{WPM:BASE} {PROSIGN:AR} ",{CALL:"ea8/om0rx/p",SERIAL:"TT1"});
    expect(plan).toEqual({schema:1,segments:[{kind:"text",text:"EA8/OM0RX/P "},{kind:"speed",wpm:18},
      {kind:"text",text:"5NN TT1"},{kind:"restore"},{kind:"text",text:" "},{kind:"prosign",value:"AR"}]});
    expect(describeCWPlan(plan)).toBe("EA8/OM0RX/P [18 WPM]5NN TT1[base WPM] <AR>");
  });
  it("bounds data, refuses raw bytes/injected context and restores temporary speed",()=>{
    for(const value of ["CQ\nCQ","CQ\x1bAR","{WPM:0}CQ","{PROSIGN:ZZ}","{CALL}","{UNKNOWN}","X".repeat(129)])
      expect(()=>compileCWMessage(value,{})).toThrow();
    expect(()=>compileCWMessage("{CALL}",{CALL:"CQ{WPM:99}"})).toThrow();
    expect(compileCWMessage("{WPM:15}CQ",{}).segments).toEqual([{kind:"speed",wpm:15},{kind:"text",text:"CQ"},{kind:"restore"}]);
    expect(compileCWMessage("CQ ",{},128,true).segments).toEqual([{kind:"text",text:"CQ "}]);
  });
  it("releases only immutable character/word/hybrid prefixes and keeps an incomplete final word",()=>{
    expect(compositionBoundary("CQ DE OM", "character",true)).toBe(8);
    expect(compositionBoundary("CQ DE OM", "word",true)).toBe(6);
    expect(compositionBoundary("C", "word",true)).toBe(0);
    expect(compositionBoundary("C", "hybrid",true)).toBe(1);
    expect(compositionBoundary("CQ DE OM", "hybrid",true)).toBe(3);
    expect(compositionBoundary("DE OM", "hybrid",false)).toBe(3);
  });
});
