import { loadGuideStation, guideTuneSession } from "./guideTuneSession";
import type { GuideMarker } from "./bandMapGuides";
import type { MonitorContext } from "./monitorContext";
import type { StationProvider } from "../worker";
import { hamlibProjection } from "./hamlibStation";

/** Explicit marker action only; reuse the existing receipt/selection fenced tune
 * owner. No QSO/draft/rotor mutation is issued here. */
export async function tuneGuideMarker(marker: GuideMarker) {
  const route = await loadGuideStation("radio1");
  const selected = route.active_radio;
  const base = selected === "radio1" ? route : await loadGuideStation(selected);
  if (base.active_radio !== selected || !base.radio || !base.selection.provider) throw new Error("Refresh the selected radio before tuning a guide marker.");
  const snapshot = base.selection.provider === "hamlib" ? hamlibProjection(base.radio.snapshot, null) : base.radio.snapshot;
  const observation = snapshot.radio ?? snapshot.observation ?? snapshot;
  const mode = marker.mode ?? observation.mode;
  if (typeof mode !== "string" || !mode) throw new Error("The marker has no mode; wait for the selected radio's current mode.");
  const context: MonitorContext = { epoch: base.generation, revision: base.revision,
    selection: { ...base.selection, provider: base.selection.provider as StationProvider }, radio: base.radio, rotor: {} };
  return guideTuneSession(selected, marker.mode).tune(base.selection.provider as StationProvider, marker.frequencyHz, mode, context);
}
