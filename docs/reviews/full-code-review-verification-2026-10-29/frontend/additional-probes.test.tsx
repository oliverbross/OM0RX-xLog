// @vitest-environment jsdom
import { useState } from "/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/node_modules/react";
import { act, cleanup, fireEvent, render, screen } from "/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/node_modules/@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QSOEditor } from "/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src/live/QSOEditorCore";
import { DeskQSO } from "/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src/live/OperatorDesk";
import { OperatorDraftSession, sameDraftValue } from "/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src/live/operatorDraftSession";

afterEach(()=>{cleanup();vi.useRealTimers();localStorage.clear();});
it.each(["full","desk"])("VERIFY main submit %s replaces canonical start before save",async mode=>{
  vi.setSystemTime(new Date("2026-10-28T12:34:56Z"));
  const original={id:crypto.randomUUID(),call:"K1ABC",start:"2026-10-20T10:15:30Z",end:null,band:"20m",mode:"CW",frequencyHz:14025000,rstSent:"599",rstReceived:"599",extraFields:{}};
  const generation=crypto.randomUUID();
  let current:any={revision:0,generation,qso:original,automaticStart:true};
  const commands:any[]=[];
  const transport=async(method:string,params:any={})=>{
    if(method==="logbook_operator_draft")return {draft:structuredClone(current)};
    if(method==="logbook_operator_draft_apply"){
      commands.push(structuredClone(params));
      if(params.action==="replace"){
        current={...current,revision:current.revision+1,qso:structuredClone(params.qso),
          automaticStart:params.qso.start!==current.qso.start||params.qso.end!==current.qso.end?false:current.automaticStart};
        return {status:"applied",receipt:{mutation:structuredClone(params),draft:structuredClone(current)}};
      }
      throw Error("VERIFY stop before native save; this probe concerns pre-save provenance only");
    }
    if(method==="logbook_operator_draft_receipt")return {receipt:null};
    throw Error(method);
  };
  const session=new OperatorDraftSession(transport,()=>{});await session.refresh();
  let submitted:any;
  function Harness(){
    const [draft,setDraft]=useState<any>(structuredClone(original));
    const save=(value?:any)=>{submitted=value;};
    return mode==="full"?<QSOEditor draft={draft} setDraft={setDraft} save={save} clear={()=>{}} busy={false} lookup={null} previous={[]} follow={false} setFollow={()=>{}} />:
      <DeskQSO draft={draft} setDraft={setDraft} save={save} clear={()=>{}} busy={false} follow={false} setFollow={()=>{}}/>;
  }
  render(<Harness/>);fireEvent.click(screen.getByRole("button",{name:"Log QSO"}));
  expect(submitted.start).toBe("2026-10-28T12:34:56.000Z");
  // This is the exact pre-save statement in MainLiveApp1114, then the real
  // session's flush stage from commit(save). Native replace behavior is modeled
  // explicitly above; root independently covers real SQLite behavior.
  session.edit(submitted);await session.flush();
  expect(commands[0].action).toBe("replace");expect(commands[0].qso.start).toBe(submitted.start);
  expect(current.automaticStart).toBe(false);
  console.log("VERIFY provenance dependency",JSON.stringify({mode,originalStart:original.start,submittedStart:submitted.start,replaceAction:commands[0].action,automaticStartAfterReplace:current.automaticStart}));
});
