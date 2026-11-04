import { useEffect, useState } from "react";
import { TCIReceiveFilter } from "./TCIReceiveFilter";
import { TCISplitObservation } from "./TCISplitObservation";
import type { RadioID } from "./stationSession";
import { pttSession } from "./pttSession";
import { PTTStatus } from "./PTTStatus";
import { invoke } from "@tauri-apps/api/core";
import { loadStationSession } from "./stationSession";
type Data = Record<string, any>;
export function TCIObservation({ radioId, snapshot, now, request }: { radioId: RadioID; snapshot: Data | null; now?: number; request?:(method:string,params?:Data)=>Promise<Data> }) {
  const [clock, setClock] = useState(Date.now);
  const [speed,setSpeed]=useState(""),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  useEffect(() => { if (now !== undefined) return; const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, [now]);
  const radio = snapshot?.radio, current = now ?? clock;
  const recent = (stamp: unknown) => typeof stamp === "number" && Number.isFinite(stamp) && current - stamp * 1000 >= -1000 && current - stamp * 1000 <= 5000;
  const fresh = snapshot?.source === "direct_tci" && snapshot.available === true && radio?.connected === true && radio?.observed === true && snapshot.station?.radio_stale !== true && recent(snapshot.generated_at) && recent(radio.observed_at);
  const hz = radio?.receive_frequency_hz ?? radio?.frequency_hz;
  const frequency = typeof hz === "number" && Number.isFinite(hz) ? `${(hz / 1e6).toFixed(6)} MHz` : "Unavailable";
  const supports=(command:string)=>snapshot?.capabilities?.supported_commands?.includes(command)===true;
  const outputReady=fresh&&snapshot?.allow_transmit===true&&snapshot.tci?.transmit_enabled===true&&recent(snapshot.tci?.trx_observed_at)&&radio?.transmitting===false;
  const applySpeed=async()=>{if(!request||busy||!outputReady)return;setBusy(true);try{await request("station_radio_control",{provider:"direct_tci",control:"set_cw_speed",expected_generation:snapshot!.generation,words_per_minute:Number(speed)});setMessage("CW macro speed command accepted; check the reported value. RF is unverified.");}catch(error){setMessage(String(error));}finally{setBusy(false);}};
  const ptt=async(on:boolean)=>{try{await pttSession().set(on,on?"direct_tci":undefined);}catch(error){setMessage(String(error));}};
  const disableTransmit=async()=>{if(busy)return;setBusy(true);try{
    const base=await loadStationSession(radioId);
    if(base.selection.provider!=="direct_tci"||base.radio?.snapshot?.generation!==snapshot?.generation)throw new Error("TCI connection changed; refresh its current state before disabling.");
    const result=await invoke<Data>("tci_transmit_disable",{radio_id:radioId,connection_generation:snapshot!.generation,generation:base.generation,revision:base.revision,operation_id:crypto.randomUUID()});
    setMessage(result.message??"TCI permission disabled and saved. Inspect retained CW/PTT release state before operating again.");
  }catch(error){setMessage(`${String(error)} Check permission and retained release state; no acquisition was retried.`);}finally{setBusy(false);}};
  return <><p role="status">{fresh ? "TCI observation current · receive controls require native checks." : "TCI observation unavailable or stale · retained values are read only."}</p>
    <p>{fresh ? "Observed receive" : "Retained receive"}: {frequency} · {radio?.mode || "Mode unavailable"}</p>
    <TCISplitObservation snapshot={snapshot} fresh={fresh} now={current} />
    <TCIReceiveFilter radioId={radioId} snapshot={snapshot} now={current} />
    <section aria-label="TCI transmit readiness"><h4>TCI PTT and CW</h4><p>{snapshot?.tci?.program ?? "Server unknown"} · TCI {snapshot?.tci?.protocol_version ?? "unknown"} · TRX {snapshot?.tci?.trx ?? "unknown"} / channel {snapshot?.tci?.channel ?? "unknown"}. Transmit permission: {snapshot?.allow_transmit ? "enabled" : "off"}.</p><p>{snapshot?.tci?.output_reason ?? "Connect a supported ExpertSDR3 TCI 2.1 route to inspect output capability."}</p>
      <button type="button" disabled={busy||!outputReady||!supports("ptt")} onClick={()=>void ptt(true)}>TCI PTT on</button><button type="button" onClick={()=>void ptt(false)}>Owned PTT off</button>
      <button type="button" disabled={busy||snapshot?.source!=="direct_tci"||!Number.isSafeInteger(snapshot?.generation)} onClick={()=>void disableTransmit()}>Disable TCI transmit now</button>
      <p>CW uses the existing CW desk and explicit Arm / Send / Stop. Whole messages only; typed speed/prosign plans and live append are unavailable on this adapter. No TCI audio injection or carrier Tune.</p>
      <label>TCI CW macro speed · WPM<input aria-label="TCI CW macro speed" type="number" min={1} max={60} value={speed} onChange={event=>setSpeed(event.target.value)} /></label><button type="button" disabled={busy||!request||!outputReady||!supports("set_cw_speed")||!Number.isInteger(Number(speed))||Number(speed)<1||Number(speed)>60} onClick={()=>void applySpeed()}>Apply TCI CW macro speed</button>
      <p>Device-reported macro speed: {snapshot?.tci?.cw_macros_speed ?? "unavailable"}. Command acceptance and observed keying are separate.</p>{message&&<p role="alert">{message}</p>}{snapshot?.tci?.output_supported&&<PTTStatus />}
    </section></>;
}
