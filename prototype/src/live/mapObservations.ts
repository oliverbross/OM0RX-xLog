// Pure observation gates shared by maps and HM Control. No renderer, event
// subscription, station owner or React dependency belongs in this module.
import { hamlibProjection } from "./hamlibStation";
import type { MapContext } from "./mapContext";

export function mapClusterFresh(context: MapContext | null, now = Date.now()): boolean {
  const source = context?.cluster;
  return !!source?.available && source.received_at_ms > 0 && now - source.received_at_ms >= -1000 && now - source.received_at_ms <= 5000;
}
export function mapRadioFrequency(context: MapContext | null, now = Date.now()): number | undefined {
  if (!context) return;
  const radio = context.radio, provider = context.selection.provider;
  if (radio.available !== true || radio.provider !== provider || !Number.isSafeInteger(radio.received_at_ms) ||
    now - radio.received_at_ms > 5000 || now - radio.received_at_ms < -1000) return;
  const projected = provider === "hamlib" ? hamlibProjection(radio.snapshot, null) : radio.snapshot;
  const observation = projected?.radio;
  if (projected?.source !== provider || observation?.connected !== true || observation?.observed !== true || projected?.station?.radio_stale === true) return;
  const hz = observation.receive_frequency_hz ?? observation.frequency_hz;
  return typeof hz === "number" && Number.isFinite(hz) && hz > 0 ? hz : undefined;
}
