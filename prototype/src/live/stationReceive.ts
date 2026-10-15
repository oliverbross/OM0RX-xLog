import type { MonitorContext } from "./monitorContext";

const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const freshSeconds = (value: unknown, now: number) => typeof value === "number" && Number.isFinite(value) && Math.abs(now - value * 1000) <= 5000;
/** Eligibility only; native admission and the FLEX backend recheck every write. */
export type StationReceiveControl = "frequency" | "mode";
export function stationReceiveAvailable(context: MonitorContext | null, control: StationReceiveControl = "frequency", now = Date.now()): boolean {
  const selection = context?.selection, projection = context?.radio, snapshot = projection?.snapshot, radio = snapshot?.radio;
  const provider = selection?.provider;
  const advertised = provider === "direct_agent"
    ? snapshot?.station?.supported_commands
    : snapshot?.capabilities?.supported_commands;
  const command = provider === "direct_agent"
    ? control === "frequency" ? "set_frequency_hz" : "set_mode"
    : control === "frequency" ? "set_frequency_a" : "set_mode_a";
  return !context?.acceptance && (provider === "direct_agent" || provider === "direct_flex_lan") && integer(selection?.control_revision)
    && projection?.provider === selection.provider && projection.selection_id === selection.selection_id && projection.selection_generation === selection.generation
    && projection.available === true && integer(projection.received_at_ms) && now - projection.received_at_ms >= -1000 && now - projection.received_at_ms <= 5000
    && snapshot?.source === provider && freshSeconds(snapshot.generated_at, now) && freshSeconds(radio?.observed_at, now)
    && integer(snapshot.generation) && radio?.connected === true && radio.observed === true && radio.transmitting === false && radio.receive_vfo === "A"
    && Array.isArray(radio.vfos) && radio.vfos.some((vfo: Record<string, unknown>) => vfo.letter === "A" && vfo.receive === true)
    && Array.isArray(advertised) && advertised.includes(command);
}
