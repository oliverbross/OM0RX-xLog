import { expect, it, vi } from "vitest";
import { frequencyBand, hamlibMode, hamlibProjection, hamlibStationRequest } from "../src/live/hamlibStation";
const radio = { observed_at_ms: 1000, field_observed_at_ms: { ptt: 1000 }, fields: { frequency: { Frequency: "14074000" }, mode: { Mode: "USB" }, ptt: { PTT: "0" } } };
it("projects observed Hamlib fields without inventing accessories or unsupported values", () => {
  const value = hamlibProjection(radio, { fields: { position: { Azimuth: "53", Elevation: "0" } } });
  expect(value.radio.frequency_hz).toBe(14074000);
  expect(value.radio.observed).toBe(true);
  expect(value.radio.transmitting).toBe(false);
  expect(value.radio.split).toBeNull();
  expect(value.radio.receive_vfo).toBeUndefined();
  expect(value.radio.transmit_frequency_hz).toBeNull();
  expect(value.station.band).toBe("20m");
  expect(value.station.kpa_operate).toBeUndefined();
  expect(value.rotor.azimuth).toBe(53);
});
it("does not present old optional telemetry as a current RX or split observation", () => {
  const value = hamlibProjection({ ...radio, observed_at_ms: 12000 }, null);
  expect(value.radio.transmitting).toBeNull();
  expect(value.radio.split).toBeNull();
});
it("maps digital operating intents to Hamlib modes and derives the observed band", () => {
  for (const mode of ["FT8", "FT4", "FT2", "PSK", "DATA", "DIGU"]) expect(hamlibMode(mode, 14074000)).toBe("PKTUSB");
  expect(hamlibMode("DIGL", 7074000)).toBe("PKTLSB");
  expect(hamlibMode("SSB", 7100000)).toBe("LSB");
  expect(frequencyBand(18082500)).toBe("17m");
  expect(frequencyBand(21325000)).toBe("15m");
  expect(frequencyBand(undefined)).toBeUndefined();
});
it("does not manufacture a zero frequency from empty or missing readings", () => {
  expect(hamlibProjection({ fields: { frequency: { Frequency: "" } } }, null).radio.observed).toBe(false);
  expect(hamlibProjection(null, null).available).toBe(false);
});
it("requires exact observed frequency and compatible mode for spot-tune success", async () => {
  const request = vi.fn(async (method: string, params?: Record<string, any>) => method === "hamlib_snapshot" ? params?.device === "radio" ? radio : {} : { state: "accepted", confirmed: true });
  const result = await hamlibStationRequest("station_tune", { frequency_hz: 14074000, mode: "SSB" }, request);
  expect(result.confirmed).toBe(true);
  expect(request.mock.calls[0]).toEqual(["hamlib_control", { device: "radio", action: "tune_simplex", mode: "USB", hz: 14074000 }]);
  await expect(hamlibStationRequest("station_tune", { frequency_hz: 14195000, mode: "USB" }, request)).rejects.toThrow("not both been observed");
});
it("read-only snapshot cannot issue connection or command writes", async () => {
  const request = vi.fn(async (_method: string, _params?: Record<string, any>) => radio);
  await hamlibStationRequest("station_snapshot", {}, request);
  expect(request.mock.calls.length).toBe(2);
  expect(request.mock.calls.every(([method]) => method === "hamlib_snapshot")).toBe(true);
});
