// Memory-only synthetic observations for tests and previews, never fallback.
import type { MonitorContext } from "./monitorContext";
export function syntheticMonitorContext(now = Date.now()): MonitorContext {
  const identity = "00000000-0000-4000-8000-000000000002";
  return { epoch: "00000000-0000-4000-8000-000000000001", revision: 1,
    selection: { provider: "direct_agent", generation: 2, selection_id: identity },
    radio: { revision: 1, provider: "direct_agent", selection_id: identity, selection_generation: 2, available: true, received_at_ms: now,
      snapshot: { source: "direct_agent", generated_at: now / 1000, allow_transmit: true,
        radio: { observed: true, connected: true, transmitting: false, frequency_hz: 14074000, mode: "USB", receive_vfo: "A", transmit_vfo: "A", vfos: [{ letter: "A", frequency_hz: 14074000 }, { letter: "B", frequency_hz: 7025000 }] },
        station: { band: "20m", allowed_actions: ["operate", "standby", "tune", "cancel"], tx_power_watts: 500, swr: 1.2, swr_is_live: true, rf_drive_watts: 25,
          kpa_operate: true, kpa_detail_primary: "Synthetic amplifier observation", kat_detail_primary: "Synthetic tuner observation",
          route_detail: "Synthetic station route", route_alignment: "Observed", alarm_summary: "Synthetic observation · no connected hardware" } } },
    rotor: { revision: 1, available: true, received_at_ms: now, snapshot: { owner: "native_dcu1", generation: 4, state: "active", backend_available: true,
      backend: { connected: true, name: "Synthetic antenna", status: "Observed", azimuth: 53, target_label: "Synthetic portable callsign", target_bearing: 90, observed_at: now / 1000 } } } };
}
