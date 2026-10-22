import {describe,expect,it,vi} from "vitest";
import {ContestVoiceRecorder,contestVoiceRecordingLimitMs,encodePCM16Mono,inspectContestVoiceProfile,previewContestVoiceSlot,saveContestVoiceSlot} from "./contestVoiceProfile";

describe("contest voice profile",()=>{
  it("encodes bounded mono PCM16 WAV",()=>{const wav=encodePCM16Mono([new Float32Array([-1,0,1])],48_000),view=new DataView(wav.buffer);
    expect(new TextDecoder().decode(wav.slice(0,4))).toBe("RIFF");expect(new TextDecoder().decode(wav.slice(8,12))).toBe("WAVE");
    expect(view.getUint16(20,true)).toBe(1);expect(view.getUint16(22,true)).toBe(1);expect(view.getUint32(24,true)).toBe(48_000);
    expect(view.getUint16(34,true)).toBe(16);expect(view.getInt16(44,true)).toBe(-32768);expect(view.getInt16(48,true)).toBe(32767);});
  it("rejects empty, oversized and invalid-rate recordings",()=>{expect(()=>encodePCM16Mono([],48_000)).toThrow("contain audio");
    expect(()=>encodePCM16Mono([new Float32Array(4_200_000)],48_000)).toThrow("8 MiB");expect(()=>encodePCM16Mono([new Float32Array(1)],1)).toThrow("sample rate");});
  it("shortens high-rate capture to remain inside the native WAV bound",()=>{expect(contestVoiceRecordingLimitMs(48_000)).toBe(60_000);
    expect(contestVoiceRecordingLimitMs(192_000)).toBeLessThan(22_000);expect(contestVoiceRecordingLimitMs(0)).toBe(0);});
  it("releases a microphone granted after capture was cancelled",async()=>{const original=Object.getOwnPropertyDescriptor(navigator,"mediaDevices"),stop=vi.fn();
    let grant!:(stream:MediaStream)=>void;const getUserMedia=vi.fn(()=>new Promise<MediaStream>(resolve=>{grant=resolve;}));
    Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia}});vi.stubGlobal("AudioContext",class{});
    try{const recorder=new ContestVoiceRecorder(),starting=recorder.start("mic");recorder.cancel();
      grant({getTracks:()=>[{stop}]} as unknown as MediaStream);await expect(starting).rejects.toThrow("cancelled");expect(stop).toHaveBeenCalledOnce();
      expect(getUserMedia).toHaveBeenCalledWith(expect.objectContaining({audio:expect.objectContaining({deviceId:{exact:"mic"},channelCount:1}),video:false}));
    }finally{vi.unstubAllGlobals();if(original)Object.defineProperty(navigator,"mediaDevices",original);else Reflect.deleteProperty(navigator,"mediaDevices");}});
  it("uses only bounded native profile commands",async()=>{const request=vi.fn(async(command:string,_args?:Record<string,unknown>)=>command==="contest_voice_profile_manifest"?{slots:[]}:
      ({slot:"f1",wavBase64:btoa("RIFF"),durationMs:1,decodedBytes:4,sha256:"a".repeat(64)}));
    await inspectContestVoiceProfile("/profile",request as any);await saveContestVoiceSlot("/profile","f1",new Uint8Array([1,2]),false,request as any);
    expect(request.mock.calls[0]).toEqual(["contest_voice_profile_manifest",{params:{profilePath:"/profile"}}]);
    expect(request.mock.calls[1][0]).toBe("contest_voice_profile_write");expect(request.mock.calls[1][1]?.params).toMatchObject({slot:"f1",overwrite:false,wavBase64:"AQI="});});
  it("previews through the selected sink without any PTT command",async()=>{const events=new Map<string,()=>void>(),audio={setSinkId:vi.fn(async()=>{}),
      play:vi.fn(async()=>queueMicrotask(()=>events.get("ended")?.())),addEventListener:vi.fn((name:string,listener:()=>void)=>events.set(name,listener))};
    const request=vi.fn(async(_command:string,_args?:Record<string,unknown>)=>({slot:"f1",wavBase64:btoa("RIFF"),durationMs:1,decodedBytes:4,sha256:"a".repeat(64)}));
    await previewContestVoiceSlot("/profile","f1","radio",request as any,()=>audio as any,()=>"blob:test",()=>{});
    expect(audio.setSinkId).toHaveBeenCalledWith("radio");expect(audio.play).toHaveBeenCalledOnce();
    expect(request.mock.calls.map(call=>call[0])).toEqual(["contest_voice_profile_preview"]);
  });
});
