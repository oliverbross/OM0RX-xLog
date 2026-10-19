import type { StationProvider } from "../worker";
import { manualTuneSession, type ManualTuneSession } from "../live/manualTune";
import { loadStationSession, type RadioID, type StationSession } from "../live/stationSession";

type Dependencies = {
  load: (radioId: RadioID) => Promise<StationSession>;
  session: (radioId: RadioID) => ManualTuneSession;
};

const providers = new Set<StationProvider>(["direct_agent", "direct_flex_lan", "direct_tci", "hamlib"]);
const defaults: Dependencies = { load: loadStationSession, session: manualTuneSession };

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
  if (tune.getSnapshot().pending) throw new Error("Review the previous manual tune receipt before selecting another spot.");
  return tune.tune(provider as StationProvider, frequencyHz, mode);
};

export const tuneContestSpot = createContestSpotTuner();
