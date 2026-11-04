import { describe, expect, it, vi } from "vitest";
import { bookmarkQTC, reviewQTC, listenToAudio, recorderKeyAction, type RecorderRead } from "./contestRecorder";
describe("listening-only recorder client",()=>{
  it("anchors QTC only to an already running exact-log capture and never starts a device",async()=>{
    const reference={schema:1 as const,sessionID:"log",seriesID:"series",itemIndex:0,operationID:"op",event:"item" as const};
    const read=vi.fn().mockResolvedValueOnce({active:null});
    await expect(bookmarkQTC(reference,"workspace",read)).rejects.toThrow("No advancing recording");
    expect(read).toHaveBeenCalledExactlyOnceWith({action:"status"});
    read.mockClear();read.mockResolvedValueOnce({active:{logId:"log",captureId:"capture",frames:100,finished:false}}).mockResolvedValueOnce({id:"marker"});
    expect(await bookmarkQTC(reference,"workspace",read)).toEqual({id:"marker"});
    expect(read.mock.calls.map(c=>c[0].action)).toEqual(["status","qtc_bookmark"]);
    expect(read.mock.calls[1][0]).toMatchObject({logId:"log",workspaceGeneration:"workspace",captureId:"capture",qtc:reference});
  });
  it("opens a QTC sample selection only after coverage lookup and never plays automatically",async()=>{
    const read=vi.fn().mockResolvedValue({available:true,rows:[{coverage:"pending"}]}),open=vi.fn().mockResolvedValue(undefined);
    await reviewQTC({logId:"log",seriesID:"series",itemIndex:2},read,open);
    expect(read).toHaveBeenCalledExactlyOnceWith({action:"qtc_review",logId:"log",seriesID:"series",itemIndex:2});expect(open).toHaveBeenCalledOnce();
    read.mockResolvedValueOnce({available:false,reason:"Missing capture"});open.mockClear();
    await expect(reviewQTC({logId:"log",seriesID:"series"},read,open)).rejects.toThrow("Missing capture");expect(open).not.toHaveBeenCalled();
  });
  it("never sends a late replay after Stop while an admitted replay is pending",async()=>{
    let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
    const calls:string[]=[];const read:RecorderRead=async request=>{calls.push(String(request.action));if(request.action==="replay_recent")await pending;return {} as any;};
    const replay=recorderKeyAction("REPLAY_10",read);
    await recorderKeyAction("STOP_REPLAY",read);release();await replay;
    expect(calls).toEqual(["replay_recent","stop_replay"]);
  });
  it("preserves the selected dataset identity and opens playback only after exact lookup",async()=>{
    const read=vi.fn().mockResolvedValue({}),open=vi.fn().mockResolvedValue(undefined);
    await listenToAudio({logId:"historical-log",qsoId:"stable-qso"},read,open);
    expect(read).toHaveBeenCalledExactlyOnceWith({action:"prepare",logId:"historical-log",qsoId:"stable-qso"});
    expect(open).toHaveBeenCalledOnce();
    read.mockRejectedValueOnce(new Error("no matching archive"));open.mockClear();
    await expect(listenToAudio({logId:"reference-log",qsoId:"same-call-and-time"},read,open)).rejects.toThrow("no matching archive");expect(open).not.toHaveBeenCalled();
  });
  it("replays the active capture by IDs and never calls a station or mutation method",async()=>{
    const calls:Record<string,unknown>[]=[];const read:RecorderRead=async request=>{calls.push(request);return request.action==="status"?{active:{logId:"log",captureId:"capture"}} as any:{};};
    expect(await recorderKeyAction("REPLAY_10",read)).toBe(true);
    expect(calls).toEqual([{action:"replay_recent",lastSeconds:10,channel:0,outputChannel:0,volume:0.15}]);
    calls.length=0;await recorderKeyAction("STOP_REPLAY",read);expect(calls).toEqual([{action:"stop_replay"}]);
    expect(await recorderKeyAction("LOG_NOW",read)).toBe(false);
  });
});
