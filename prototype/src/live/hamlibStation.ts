// A single station contract for the shared UI. No macOS xCat companion is needed.
type Data = Record<string, any>;
type Invoke = (method: string, params?: Data) => Promise<Data>;
const number = (v: unknown): number | undefined => typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : typeof v === "number" && Number.isFinite(v) ? v : undefined;
export function hamlibMode(mode: string, hz: number): string {
  const upper = mode.toUpperCase();
  if (upper === "SSB") return hz < 10_000_000 ? "LSB" : "USB";
  return ["FT8", "FT4", "FT2", "JTTY", "PSK", "DIGI", "DATA", "DIGU"].includes(upper) ? "PKTUSB" : upper === "DIGL" ? "PKTLSB" : upper;
}
export function frequencyBand(hz: number | undefined): string | undefined {
  if (hz == null) return undefined;
  return ([[1.8, 2, "160m"], [3.5, 4, "80m"], [5, 5.5, "60m"], [7, 7.3, "40m"], [10.1, 10.15, "30m"], [14, 14.35, "20m"], [18.068, 18.168, "17m"], [21, 21.45, "15m"], [24.89, 24.99, "12m"], [28, 29.7, "10m"], [50, 54, "6m"], [70, 71, "4m"], [144, 148, "2m"], [420, 450, "70cm"]] as [number, number, string][]).find(([lo, hi]) => hz >= lo * 1e6 && hz <= hi * 1e6)?.[2];
}
export function hamlibProjection(radio: Data | null, rotor: Data | null): Data {
  const f = radio?.fields || {}, r = rotor?.fields?.position || {};
  const extra = (name: string) => {
    const age = radio?.observed_at_ms - radio?.field_observed_at_ms?.[name];
    return Number.isFinite(age) && age <= 10_000 ? f[name] : undefined;
  };
  const hz = number(f.frequency?.Frequency), mode = f.mode?.Mode;
  const observed = hz !== undefined && typeof mode === "string";
  const vfo = extra("vfo")?.VFO?.replace("VFO", "");
  const split = number(extra("split")?.Split);
  return { source: "hamlib", available: observed, generation: radio?.generation, transport_state: radio ? "connected" : "disconnected",
    generated_at: Date.now() / 1000, allow_transmit: radio?.tx_enabled === true,
    radio: { observed, connected: !!radio, frequency_hz: hz, receive_frequency_hz: hz, mode,
      receive_vfo: vfo, transmit_vfo: split == null ? null : split ? extra("split")?.["TX VFO"]?.replace("VFO", "") : vfo,
      transmit_frequency_hz: split == null ? null : split ? number(extra("tx_frequency")?.["TX Frequency"]) : hz,
      split: split === undefined ? null : split !== 0, transmitting: number(extra("ptt")?.PTT) === undefined ? null : number(extra("ptt")?.PTT)! !== 0,
      received_at: radio?.observed_at_ms / 1000, observed_at: radio?.observed_at_ms / 1000,
      vfos: observed && vfo ? [{ letter: vfo, frequency_hz: hz, mode, receive: true, transmit: split === 0 }] : [] },
    station: { radio_known: observed, radio_stale: !observed, local: true, band: frequencyBand(hz), allowed_actions: [],
      supported_commands: radio ? ["set_receive_frequency_a", "set_receive_mode_a"] : [],
      alarm_summary: !radio ? "Local radio disconnected" : observed ? "Local radio observed" : "Hamlib frequency or mode unavailable",
      inhibitors: [], route_alignment: "Local station", rf_drive_fraction: number(extra("rf_power")?.["RFPOWER"]), hamlib_errors: radio?.errors || {} },
    rotor: { connected: !!rotor && number(r.Azimuth) !== undefined, name: "Hamlib rotor", azimuth: number(r.Azimuth), elevation: number(r.Elevation),
      observed_at: rotor?.observed_at_ms / 1000, status: rotor ? "Observed" : "Disconnected" }, hamlib: { radio, rotor } };
}
export async function hamlibStationRequest(method: string, params: Data, invoke: Invoke): Promise<Data> {
  const snapshot = async () => {
    // Independent rotor telemetry has its own native owner. Radio refreshes
    // must not create a second periodic read path to that device.
    let radio: Data | null = null;
    try { radio = await invoke("hamlib_snapshot", { device: "radio" }); } catch { /* Project the disconnected radio. */ }
    return hamlibProjection(radio, null);
  };
  if (method === "station_snapshot") return snapshot();
  if (method === "station_tune") {
    // The backend owns one locked simplex transaction, including split/VFO.
    const mode = hamlibMode(params.mode, params.frequency_hz);
    const tuned = await invoke("hamlib_control", { device: "radio", action: "tune_simplex", mode, hz: params.frequency_hz });
    const state = await snapshot();
    const expected = [mode];
    const confirmed = tuned.confirmed === true && state.radio?.observed && state.radio.frequency_hz === params.frequency_hz && expected.includes(state.radio.mode);
    if (!confirmed) throw new Error("Hamlib accepted the tune but frequency and mode have not both been observed. Check the radio before retrying.");
    return { confirmed: true, accepted: true, state };
  }
  if (method === "station_rotor_goto" || (method === "station_action" && params.action === "rotor_goto")) {
    const result = await invoke("hamlib_control", { device: "rotor", action: "goto", azimuth: params.bearing, elevation: params.elevation ?? 0 });
    return { accepted: result.state === "accepted", confirmed: false, state: await snapshot() };
  }
  if (method === "station_rotor_stop" || (method === "station_action" && params.action === "rotor_stop")) {
    const result = await invoke("hamlib_control", { device: "rotor", action: "stop" });
    return { accepted: result.state === "accepted", state: await snapshot() };
  }
  throw new Error("This action is not available for the selected local station. Use its Hamlib controls.");
}
