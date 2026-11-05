// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CWComposition from "./CWComposition";
import type { SharedCWState, CWComposeRequest } from "./sharedCWSession";

const armed = {armed:true,pending:false,capabilities:{composition:true},composition:null} satisfies Partial<SharedCWState>;
afterEach(cleanup);
describe("deliberate CW workbench input",()=>{
  it("keeps programmatic changes, paste and IME staged and explicit Send preserves origin",async()=>{
    const compose=vi.fn<(request:CWComposeRequest)=>Promise<boolean>>(async()=>true), stop=vi.fn(async()=>{});
    const view=render(<CWComposition context={{CALL:"OM0RX"}} state={armed} compose={compose} stop={stop} mode="character"/>);
    const input=screen.getByLabelText("Editable text");
    fireEvent.click(screen.getByLabelText("Enable live typing"));
    view.rerender(<CWComposition context={{CALL:"EA8/OM0RX/P"}} state={armed} compose={compose} stop={stop} mode="character"/>);
    expect(compose).not.toHaveBeenCalled();
    fireEvent.paste(input);
    fireEvent.input(input,{target:{value:"CQ DE OM0RX"},inputType:"insertFromPaste"});
    expect(compose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Send / finish"));
    await waitFor(()=>expect(compose).toHaveBeenCalledTimes(1));
    expect(compose.mock.calls[0]).toEqual([expect.objectContaining({template:"CQ DE OM0RX",live:false,finish:true,inputOrigin:"explicit-send",appendSequence:1})]);
    await waitFor(()=>expect((screen.getByLabelText("Editable text") as HTMLTextAreaElement).value).toBe(""));
    fireEvent.compositionStart(input);
    fireEvent.input(input,{target:{value:"TEST"},inputType:"insertCompositionText",isComposing:true});
    fireEvent.click(screen.getByText("Send / finish"));
    input.focus();fireEvent(window,new Event("xlog:cw-compose-send"));
    expect(compose).toHaveBeenCalledTimes(1);
    fireEvent.compositionEnd(input);fireEvent.click(screen.getByText("Send / finish"));
    await waitFor(()=>expect(compose).toHaveBeenCalledTimes(2));
    expect(compose.mock.calls[1][0]).toMatchObject({template:"TEST",inputOrigin:"explicit-send",live:false});
  });
  it("appends only new immutable character deltas and finishes without replaying a growing string",async()=>{
    const compose=vi.fn<(request:CWComposeRequest)=>Promise<boolean>>(async()=>true);
    render(<CWComposition context={{}} state={armed} compose={compose} stop={async()=>{}} mode="character"/>);
    const input=screen.getByLabelText("Editable text");
    fireEvent.click(screen.getByLabelText("Enable live typing"));
    fireEvent.input(input,{target:{value:"C"},inputType:"insertText"});
    await waitFor(()=>expect(compose).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect((input as HTMLTextAreaElement).value).toBe(""));
    fireEvent.input(input,{target:{value:"Q"},inputType:"insertText"});
    await waitFor(()=>expect(compose).toHaveBeenCalledTimes(2));
    await waitFor(()=>expect((input as HTMLTextAreaElement).value).toBe(""));
    fireEvent.click(screen.getByText("Send / finish"));
    await waitFor(()=>expect(compose).toHaveBeenCalledTimes(3));
    const requests=compose.mock.calls.map(call=>call[0]);
    expect(requests.map(r=>[r.template,r.appendSequence,r.finish,r.inputOrigin])).toEqual([
      ["C",1,false,"typing"],["Q",2,false,"typing"],["",3,true,"explicit-send"]]);
    expect(new Set(requests.map(r=>r.jobID)).size).toBe(1);
  });
  it("holds a word tail and never retries uncertain output or erases the QSO",async()=>{
    const compose=vi.fn<(request:CWComposeRequest)=>Promise<boolean>>(async()=>false), stop=vi.fn(async()=>{});
    render(<CWComposition context={{CALL:"K1ABC"}} state={armed} compose={compose} stop={stop} mode="word"/>);
    const input=screen.getByLabelText("Editable text");
    fireEvent.click(screen.getByLabelText("Enable live typing"));
    fireEvent.input(input,{target:{value:"CQ"},inputType:"insertText"});expect(compose).not.toHaveBeenCalled();
    fireEvent.input(input,{target:{value:"CQ "},inputType:"insertText"});
    await waitFor(()=>expect(compose).toHaveBeenCalledTimes(1));
    await screen.findByText(/Composition outcome is uncertain/);
    fireEvent.input(input,{target:{value:"NEXT"},inputType:"insertText"});
    expect(compose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Stop CW"));await waitFor(()=>expect(stop).toHaveBeenCalledTimes(1));
    expect((input as HTMLTextAreaElement).value).toBe("NEXT");
  });
  it("shows attributed radio progress and disables live on an unavailable CWX route",()=>{
    const compose=vi.fn(async()=>true),stop=vi.fn(async()=>{});
    const view=render(<CWComposition context={{}} state={{...armed,composition:{jobID:"job",appendSequence:2,accepted:"OM0RX",closed:false,evidence:"radio",reportedCharacters:3}}} compose={compose} stop={stop}/>);
    expect(screen.getByText(/3\/5 characters/)).toBeTruthy();
    const reported=screen.getByText(/Radio reported:/);
    expect(reported.textContent).toContain("OM0");expect(reported.textContent).not.toContain("OM0RX");
    view.rerender(<CWComposition context={{}} state={{...armed,capabilities:{composition:false,compositionReason:"CWX progress has no attributable client handle"}}} compose={compose} stop={stop}/>);
    expect((screen.getByLabelText("Enable live typing") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/CWX progress has no attributable/)).toBeTruthy();
    const input=screen.getByLabelText("Editable text");
    fireEvent.input(input,{target:{value:"CQ TEST"},inputType:"insertText"});
    expect(compose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Send / finish"));
    expect(compose).toHaveBeenCalledWith(expect.objectContaining({template:"CQ TEST",live:false,finish:true}));
  });
  it("retires the editable tail after global Stop and reconnect until explicit Send",async()=>{
    const compose=vi.fn(async()=>true),stop=vi.fn(async()=>{});
    const view=render(<CWComposition context={{}} state={armed} compose={compose} stop={stop} mode="word"/>);
    fireEvent.click(screen.getByLabelText("Enable live typing"));
    fireEvent.input(screen.getByLabelText("Editable text"),{target:{value:"OLD"},inputType:"insertText"});
    view.rerender(<CWComposition context={{}} state={{...armed,armed:false}} compose={compose} stop={stop} mode="word"/>);
    view.rerender(<CWComposition context={{}} state={armed} compose={compose} stop={stop} mode="word"/>);
    expect((screen.getByLabelText("Enable live typing") as HTMLInputElement).disabled).toBe(true);
    fireEvent.input(screen.getByLabelText("Editable text"),{target:{value:"OLD NEW "},inputType:"insertText"});
    expect(compose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Send / finish"));
    await waitFor(()=>expect(compose).toHaveBeenCalledWith(expect.objectContaining({template:"OLD NEW ",live:false,finish:true})));
  });
});
