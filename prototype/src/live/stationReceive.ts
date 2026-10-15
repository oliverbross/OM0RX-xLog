import type { MonitorContext } from "./monitorContext";
import { hamlibProjection } from "./hamlibStation";

const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const freshSeconds = (value: unknown, now: number) => typeof value === "number" && Number.isFinite(value) && Math.abs(now - value * 1000) <= 5000;
/** Eligibility only; native admission and the FLEX backend recheck every write. */
export type StationReceiveControl = "frequency" | "mode";
export function stationReceiveAvailable(context: MonitorContext | null, control: StationReceiveControl = "frequency", now = Date.now()): boolean {
  const selection = context?.selection, projection = context?.radio, rawSnapshot = projection?.snapshot;
  const provider = selection?.provider;
  const snapshot = provider === "hamlib" ? hamlibProjection(rawSnapshot, null) : rawSnapshot;
  const radio = snapshot?.radio;
  const advertised = provider === "direct_agent" || provider === "hamlib"
    ? snapshot?.station?.supported_commands
    : snapshot?.capabilities?.supported_commands;
  const command = provider === "direct_agent"
    ? control === "frequency" ? "set_frequency_hz" : "set_mode"
    : provider === "hamlib"
      ? control === "frequency" ? "set_receive_frequency_a" : "set_receive_mode_a"
    : control === "frequency" ? "set_frequency_a" : "set_mode_a";
  const hamlibEvidenceFresh = provider !== "hamlib" || ["vfo", "ptt"].every(field => {
    const observed = rawSnapshot?.field_observed_at_ms?.[field];
    return integer(observed) && now - observed >= -1000 && now - observed <= 5000;
  });
  return !context?.acceptance && (provider === "direct_agent" || provider === "direct_flex_lan" || provider === "hamlib") && integer(selection?.control_revision)
    && projection?.provider === selection.provider && projection.selection_id === selection.selection_id && projection.selection_generation === selection.generation
    && projection.available === true && integer(projection.received_at_ms) && now - projection.received_at_ms >= -1000 && now - projection.received_at_ms <= 5000
    && snapshot?.source === provider && freshSeconds(snapshot.generated_at, now) && freshSeconds(radio?.observed_at, now) && hamlibEvidenceFresh
    && integer(snapshot.generation) && radio?.connected === true && radio.observed === true && radio.transmitting === false && radio.receive_vfo === "A"
    && Array.isArray(radio.vfos) && radio.vfos.some((vfo: Record<string, unknown>) => vfo.letter === "A" && vfo.receive === true)
    && Array.isArray(advertised) && advertised.includes(command);
}
