import { describe, it, expect } from "vitest";
import { changedCallDraft, enrichedDraft, sameNormalLogCall } from "./draftEnrichment";
describe("callsign-scoped enrichment", () => {
  const old = { id: "draft", call: "M6KUP", name: "Old name", country: "England", dxcc: 223, gridSquare: "IO81", frequencyHz: 14222000, extraFields: { TEST: "keep" } };
  it("clears inherited identity on a new call and preserves explicit spot fields", () => {
    const next = changedCallDraft(old, { ...old, call: "OM0AAO", country: "Slovakia", dxcc: 504 });
    expect(next).toMatchObject({ call: "OM0AAO", name: "", gridSquare: "", country: "Slovakia", dxcc: 504, frequencyHz: 14222000, extraFields: old.extraFields });
  });
  it("fills QRZ details and corrects stale entity without replacing concurrent manual edits", () => {
    const baseline = { ...old, call: "OM0AAO", name: "", gridSquare: "" };
    expect(enrichedDraft({ ...baseline, name: "My chosen name" }, baseline, { call: "OM0AAO", country: "Slovakia", dxcc: 504, name: "Viliam", gridSquare: "JN88WT" }))
      .toMatchObject({ name: "My chosen name", country: "Slovakia", dxcc: 504, gridSquare: "JN88WT" });
    expect(enrichedDraft({ ...baseline, country: "Manual country" }, baseline, { call: "OM0AAO", country: "Slovakia" })?.country).toBe("Manual country");
  });
  it("rejects stale replies across call and draft identity changes", () => {
    const current = { ...old, call: "VK8NSB" };
    expect(enrichedDraft(current, old, { call: "M6KUP", name: "Wrong" })).toBe(current);
    const replacement = { ...old, id: "new" };
    expect(enrichedDraft(replacement, old, { call: "M6KUP", name: "Wrong" })).toBe(replacement);
  });
  it("respects an operator deliberately clearing fields during a lookup", () => {
    expect(enrichedDraft({ ...old, name: "", gridSquare: "", country: "" }, old,
      { call: old.call, name: "Restored", gridSquare: "IO82", country: "England" }))
      .toMatchObject({ name: "", gridSquare: "", country: "" });
    expect(changedCallDraft({ ...old, sig: "COTA", sigInfo: "OM-001" }, { ...old, call: "EA7EU", sig: "COTA", sigInfo: "OM-001" }))
      .toMatchObject({ sig: "", sigInfo: "" });
  });
  it("matches normal-log operating suffixes without merging location prefixes", () => {
    expect(sameNormalLogCall("EA1FOX/P", "ea1fox")).toBe(true);
    expect(sameNormalLogCall("G7SQW", "G7SQW/QRP")).toBe(true);
    expect(sameNormalLogCall("9A/SP9WLG/P", "SP9WLG/P")).toBe(false);
  });
});
