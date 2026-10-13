import { describe, expect, it } from "vitest";
import { defaultLogbookColumnPreferences, logbookColumnsKey, readLogbookColumnPreferences } from "./logbookColumnPreferences";

describe("logbook presentation preferences", () => {
  it("keeps all existing fields by default and isolates contexts from cluster preferences", () => {
    expect(defaultLogbookColumnPreferences().columns).toEqual(["utc", "call", "bandMode", "frequency", "rst", "country", "qsl", "lotw", "clublog", "comment"]);
    expect(logbookColumnsKey("docked")).not.toBe(logbookColumnsKey("detached"));
    expect(logbookColumnsKey("docked")).not.toContain("cluster");
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
