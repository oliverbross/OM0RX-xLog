import { expect, it } from "vitest";
import { defaultAlertColumns, orderedAlertColumns, readAlertColumns } from "./alertColumnPreferences";

it("recovers missing, malformed, oversized, future and unknown-only column preferences", () => {
  for (const raw of [null, "{", "x".repeat(4097), "null", "[]", '{"version":2,"columns":["call"]}',
    '{"version":1}', '{"version":1,"columns":[]}', '{"version":1,"columns":["unknown"]}'])
    expect(readAlertColumns(raw)).toEqual(defaultAlertColumns());
});

it("normalizes known columns in table order and always retains selection and callsign", () => {
  const preferences = readAlertColumns('{"version":1,"columns":["history","unknown","history",null]}');
  expect(preferences).toMatchObject({ version:1, columns:["select", "call", "history"] });
  expect(readAlertColumns(JSON.stringify(preferences))).toEqual(preferences);
  expect(readAlertColumns('{"version":1,"columns":["call"]}').columns).toEqual(["select", "call"]);
});

it("migrates visibility-only v1 data with default order and widths", () => {
  expect(readAlertColumns('{"version":1,"columns":["call","comment"]}')).toEqual({ ...defaultAlertColumns(), columns:["select", "call", "comment"] });
});

it("anchors mandatory columns, removes invalid or duplicate order IDs and bounds finite widths", () => {
  const result = readAlertColumns(JSON.stringify({ version:1, columns:["call", "comment"],
    order:["comment", "select", "unknown", "call", "comment", null],
    widths:{ select:1, call:1, source:9999, frequency:123.7, mode:"240", why:null, comment:200 } }));
  expect(result.order).toEqual(["select", "call", "comment", "source", "frequency", "mode", "why", "history"]);
  expect(result.widths).toMatchObject({ select:60, call:96, source:480, frequency:124, mode:70, why:240, comment:200 });
  expect(readAlertColumns(JSON.stringify(result))).toEqual(result);
  for (const order of [null, "comment", 3, {}])
    expect(orderedAlertColumns(order).map(([id]) => id)).toEqual(defaultAlertColumns().order);
});
