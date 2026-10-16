import { expect, it } from "vitest";
import { validTCIConfiguration } from "./stationSession";
const configuration = (endpoint: string) => ({ endpoint, trx: 0, channel: 0 });
it("TCI bounds both UTF-8 input and canonical URL bytes before native Save", () => {
  const prefix = "ws://radio.example/", exact = prefix + "a".repeat(2048 - prefix.length);
  expect(validTCIConfiguration(configuration(exact))).toBe(true);
  expect(validTCIConfiguration(configuration(exact + "a"))).toBe(false);
  const expands = prefix + "é".repeat(500);
  expect(new TextEncoder().encode(expands).length).toBeLessThan(2048);
  expect(new URL(expands).href.length).toBeGreaterThan(2048);
  expect(validTCIConfiguration(configuration(expands))).toBe(false);
});
it("TCI rejects port zero while preserving omitted and upper-bound ports", () => {
  expect(validTCIConfiguration(configuration("ws://localhost:0"))).toBe(false);
  expect(validTCIConfiguration(configuration("ws://localhost"))).toBe(true);
  expect(validTCIConfiguration(configuration("wss://radio.example/tci"))).toBe(true);
  expect(validTCIConfiguration(configuration("ws://localhost:65535"))).toBe(true);
});
