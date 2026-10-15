import { describe, expect, it } from "vitest";
import { defaultLogbookColumnPreferences, legacyDeskLogbookColumnsKey, logbookColumnsKey,
  migrateLegacyDeskLogbookColumnPreferences, readLogbookColumnPreferences } from "./logbookColumnPreferences";

describe("logbook presentation preferences", () => {
  it("keeps all existing fields by default and isolates contexts from cluster preferences", () => {
    expect(defaultLogbookColumnPreferences().columns).toEqual(["utc", "call", "bandMode", "frequency", "rst", "country", "qsl", "lotw", "clublog", "comment"]);
    expect(logbookColumnsKey("docked")).not.toBe(logbookColumnsKey("detached"));
    expect(logbookColumnsKey("docked")).not.toContain("cluster");
    expect(new Set((["docked", "detached", "desk"] as const).map(logbookColumnsKey)).size).toBe(3);
    expect(logbookColumnsKey("desk")).toBe("xlog.integration.logbook-columns.desk.v2");
    expect(legacyDeskLogbookColumnsKey).toBe("xlog.integration.logbook-columns.desk.v1");
  });
  it("defaults the Desk to the same normal columns without sharing its stored preferences", () => {
    expect(defaultLogbookColumnPreferences("desk")).toEqual(defaultLogbookColumnPreferences());
    expect(defaultLogbookColumnPreferences("docked")).toEqual(defaultLogbookColumnPreferences());
    expect(defaultLogbookColumnPreferences("detached")).toEqual(defaultLogbookColumnPreferences());
  });
  it.each([null, "{", "[]", '{"version":2}', '{"version":1,"columns":[]}', '{"version":1,"columns":["unknown"]}'])("uses the Desk defaults for absent or damaged Desk storage: %s", raw => {
    expect(readLogbookColumnPreferences(raw, "desk")).toEqual(defaultLogbookColumnPreferences("desk"));
  });
  it("uses the same validated normalization for optional Desk columns and widths", () => {
    const value = readLogbookColumnPreferences(JSON.stringify({ version: 1, columns: ["rst", "comment", "rst", "unknown"], widths: { rst: 999, call: -1 } }), "desk");
    expect(value.columns).toEqual(["call", "rst", "comment"]);
    expect(value.widths).toMatchObject({ rst: 480, call: 96 });
  });
  it("promotes only the untouched legacy Desk default and preserves real v1 customizations", () => {
    const widths = defaultLogbookColumnPreferences().widths;
    const untouched = JSON.stringify({ version: 1, columns: ["utc", "call", "bandMode", "frequency", "country"], widths });
    expect(migrateLegacyDeskLogbookColumnPreferences(untouched)).toEqual(defaultLogbookColumnPreferences("desk"));
    const hidden = JSON.stringify({ version: 1, columns: ["call", "rst", "comment"], widths });
    expect(migrateLegacyDeskLogbookColumnPreferences(hidden).columns).toEqual(["call", "rst", "comment"]);
    const resized = JSON.stringify({ version: 1, columns: ["utc", "call", "bandMode", "frequency", "country"],
      widths: { ...widths, call: 177 } });
    expect(migrateLegacyDeskLogbookColumnPreferences(resized)).toMatchObject({
      columns: ["utc", "call", "bandMode", "frequency", "country"], widths: { call: 177 },
    });
  });
  it("restores canonical order, removes unknown/duplicate fields and always retains Callsign", () => {
    const value = readLogbookColumnPreferences(JSON.stringify({ version: 1, columns: ["comment", "utc", "utc", "unknown"] }));
    expect(value.columns).toEqual(["utc", "call", "comment"]);
    expect(readLogbookColumnPreferences(JSON.stringify({ version: 1, columns: ["call"] })).columns).toEqual(["call"]);
  });
  it("clamps finite widths, protects Callsign readability and rejects nonnumeric widths", () => {
    const value = readLogbookColumnPreferences(JSON.stringify({ version: 1, widths: { call: -100, utc: 999, rst: 83.6, country: "200", comment: null } }));
    expect(value.widths).toMatchObject({ call: 96, utc: 480, rst: 84, country: 150, comment: 230 });
  });
  it.each([null, "{", "[]", "null", '{"version":2}', "x".repeat(4097), '{"version":1,"columns":[]}', '{"version":1,"columns":["unknown"]}'])("damaged preferences never empty or block the logbook: %s", raw => {
    expect(readLogbookColumnPreferences(raw)).toEqual(defaultLogbookColumnPreferences());
  });
  it("round-trips a customized layout without affecting contact data", () => {
    const value = defaultLogbookColumnPreferences(); value.columns = ["call", "rst"]; value.widths.rst = 145;
    expect(readLogbookColumnPreferences(JSON.stringify(value))).toEqual(value);
    expect(defaultLogbookColumnPreferences().widths.rst).toBe(92);
  });
});
