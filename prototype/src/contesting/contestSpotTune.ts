import type { StationProvider } from "../worker";
import { manualTuneSession, type ManualTuneSession } from "../live/manualTune";
import { loadStationSession, type RadioID, type StationSession } from "../live/stationSession";

type Dependencies = {
  load: (radioId: RadioID) => Promise<StationSession>;
  session: (radioId: RadioID) => ManualTuneSession;
};

const providers = new Set<StationProvider>(["direct_agent", "direct_flex_lan", "direct_tci", "hamlib"]);
const defaults: Dependencies = { load: loadStationSession, session: manualTuneSession };

const observedVFO = (station: StationSession) => {
  const snapshot=station.radio?.snapshot,provider=station.selection.provider;
  const frequency=provider==="hamlib"?Number(snapshot?.fields?.frequency?.Frequency):snapshot?.radio?.receive_frequency_hz??snapshot?.radio?.frequency_hz;
  const mode=String(provider==="hamlib"?snapshot?.fields?.mode?.Mode??"":snapshot?.radio?.mode??"").trim().toUpperCase();
  if(!Number.isSafeInteger(frequency)||frequency<100_000||frequency>1_000_000_000||!/^[A-Z0-9]{1,16}$/.test(mode))
    throw new Error("A current observed xLog VFO frequency and mode are required before stepping.");
  return {frequencyHz:frequency as number,mode};
};

async function activeStation(load:Dependencies["load"]){
  const primary=await load("radio1"),radioId=primary.active_radio,current=radioId==="radio1"?primary:await load(radioId);
  if(current.active_radio!==radioId)throw new Error("The active radio changed. Try the VFO step again after the station refreshes.");
  const provider=current.selection.provider;
  if(!provider||!providers.has(provider as StationProvider))throw new Error("Select and refresh an xLog radio before tuning.");
  return {current,radioId,provider:provider as StationProvider};
}

/** Route one explicit contest spot choice through xLog's durable manual-tune owner. */
export const createContestSpotTuner = ({ load, session }: Dependencies = defaults) => async (frequencyHz: number, mode: string) => {
  const primary = await load("radio1");
  const radioId = primary.active_radio;
  const current = radioId === "radio1" ? primary : await load(radioId);
  if (current.active_radio !== radioId) throw new Error("The active radio changed. Select the spot again after the station refreshes.");
  const provider = current.selection.provider;
  if (!provider || !providers.has(provider as StationProvider)) throw new Error("Select and refresh an xLog radio before tuning a contest spot.");
  const tune = session(radioId);
  if (tune.getSnapshot().pending) await tune.check();
  const retained = tune.getSnapshot();
  if (retained.pending && retained.reviewable) await tune.review();
  if (tune.getSnapshot().pending) throw new Error("Review the previous manual tune receipt before selecting another spot.");
  return tune.tune(provider as StationProvider, frequencyHz, mode);
};

export const tuneContestSpot = createContestSpotTuner();

/** Step from one exact observed VFO state through the durable manual-tune owner. */
export const createContestVFOStepper = ({load,session}:Dependencies=defaults)=>async(direction:"up"|"down")=>{
  const {current,radioId,provider}=await activeStation(load),source=observedVFO(current);
  const step=source.mode==="CW"||source.mode==="CWR"?20:["SSB","USB","LSB"].includes(source.mode)?100:null;
  if(step===null)throw new Error("Not1MM VFO stepping is available only for an observed CW or SSB mode.");
  const frequencyHz=source.frequencyHz+(direction==="up"?step:-step);
  if(!Number.isSafeInteger(frequencyHz)||frequencyHz<100_000||frequencyHz>1_000_000_000)throw new Error("The VFO step target is outside the supported tuning range.");
  const tune=session(radioId);if(tune.getSnapshot().pending)await tune.check();
  if(tune.getSnapshot().pending)throw new Error("Review the previous manual tune receipt before stepping the VFO.");
  return tune.tune(provider,frequencyHz,source.mode,undefined,source);
};
export const stepContestVFO=createContestVFOStepper();
