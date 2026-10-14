import { invoke } from "@tauri-apps/api/core";
import { validMapContext } from "./live/mapContext";

/** This verifies only the explicitly labelled isolated fixture, never live RF
 * observations. The real map surface must separately have rendered its scale. */
export async function verifyBandMapContext(scale: string | null, focused = false) {
  if (!focused && (!scale || !/^\d+%$/.test(scale))) throw new Error("Missing rendered band-map scale");
  const deadline = Date.now() + 15_000;
  do {
    const value: any = await invoke("map_context_snapshot");
    const marker = value?.acceptance;
    const observed = value?.cluster?.received_at_ms;
    if (!validMapContext(value) || marker?.synthetic !== true ||
      marker?.source !== "isolated_local_worker" || marker?.externalOwners !== false ||
      value.selection.provider !== null || value.radio.available !== false || value.radio.provider !== null ||
      value.radio.snapshot !== null || value.cluster.available !== true ||
      !Number.isSafeInteger(observed) || Date.now() - observed > 5000 || Date.now() - observed < -1000 ||
      value.cluster.selected !== null || value.cluster.response?.snapshot?.spots?.length !== 0) {
      throw new Error("Isolated band-map context could not be verified without external owners");
    }
    if (focused || `${Math.round(value.metadata.preferences.bandMapFontScale * 100)}%` === scale) {
      return { synthetic: true, source: "isolated_local_worker", externalOwners: false,
        generation: value.metadata.generation, revision: value.metadata.revision, scale };
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error("Rendered band-map scale was not durably acknowledged by the isolated workspace");
}
