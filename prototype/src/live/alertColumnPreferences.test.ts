import { expect, it } from "vitest";
import { defaultAlertColumns, readAlertColumns } from "./alertColumnPreferences";

it("recovers missing, malformed, oversized, future and unknown-only column preferences", () => {
  for (const raw of [null, "{", "x".repeat(4097), "null", "[]", '{"version":2,"columns":["call"]}',
    '{"version":1}', '{"version":1,"columns":[]}', '{"version":1,"columns":["unknown"]}'])
    expect(readAlertColumns(raw)).toEqual(defaultAlertColumns());
});

it("normalizes known columns in table order and always retains selection and callsign", () => {
  const preferences = readAlertColumns('{"version":1,"columns":["history","unknown","history",null]}');
  expect(preferences).toEqual({ version:1, columns:["select", "call", "history"] });
  expect(readAlertColumns(JSON.stringify(preferences))).toEqual(preferences);
  expect(readAlertColumns('{"version":1,"columns":["call"]}').columns).toEqual(["select", "call"]);
});
