import { describe, expect, it } from "vitest";
import { contestKeyChord, defaultContestKeyBindings, encodeContestKeyBindings, normalizeContestKey,
  readContestKeyBindings, resolveContestKeyBinding, validateContestKeyBindings } from "./contestKeyBindings";

describe("contest key bindings", () => {
  it("stores the supported pinned Not1MM defaults inside the host preference limit", () => {
    const encoded = encodeContestKeyBindings(defaultContestKeyBindings);
    expect(new TextEncoder().encode(encoded).length).toBeLessThanOrEqual(512);
    expect(validateContestKeyBindings(encoded)).toEqual(defaultContestKeyBindings);
  });

  it("migrates the old row representation without trusting stored descriptions", () => {
    expect(readContestKeyBindings(JSON.stringify([{ context: "*", key: "control+r", action: "TOGGLE_RUN", description: "wrong" }])))
      .toEqual([{ context: "*", key: "control+r", action: "TOGGLE_RUN" }]);
    expect(validateContestKeyBindings(JSON.stringify([{ context: "*", key: "control+r", action: "TOGGLE_RUN", description: "wrong" }])))
      .toEqual([{ context: "*", key: "Ctrl+R", action: "TOGGLE_RUN" }]);
    expect(readContestKeyBindings(JSON.stringify([
      { context: "*", key: "Ctrl+W", action: "WIPE", description: "old" },
      { context: "*", key: "Ctrl+Shift+K", action: "TOGGLE_CW_INPUT", description: "not yet owned" },
    ]))).toEqual([{ context: "*", key: "Ctrl+W", action: "CLEAR_INPUTS" }]);
  });

  it("reads Not1MM's key-to-action map and keeps context precedence", () => {
    const bindings = validateContestKeyBindings(JSON.stringify({ "Ctrl+L": "LOG_NOW", "Callsign:Up": "PREV_SPOT", "Up": "NEXT_SPOT" }));
    expect(resolveContestKeyBinding(bindings, "Callsign", "Up")).toBe("PREV_SPOT");
    expect(resolveContestKeyBinding(bindings, "Report", "Up")).toBe("NEXT_SPOT");
  });

  it("keeps an intentionally empty binding table empty", () => {
    expect(readContestKeyBindings("[]")).toEqual([]);
    expect(validateContestKeyBindings(encodeContestKeyBindings(readContestKeyBindings("[]")))).toEqual([]);
  });

  it("rejects duplicate, unsupported and workflow-reserved bindings", () => {
    expect(() => validateContestKeyBindings(JSON.stringify([["*", "Ctrl+R", "TOGGLE_RUN"], ["*", "control+r", "LOG_NOW"]]))).toThrow(/Duplicate/);
    expect(() => validateContestKeyBindings(JSON.stringify([["*", "Ctrl+K", "UNKNOWN"]]))).toThrow(/Unsupported key action/);
    expect(() => validateContestKeyBindings(JSON.stringify([["*", "Shift+F1", "LOG_NOW"]]))).toThrow(/reserved/);
    expect(() => validateContestKeyBindings(JSON.stringify([["CW entry", "Ctrl+K", "LOG_NOW"]]))).toThrow(/Unsupported key context/);
  });

  it("normalizes editable chords and browser keyboard events", () => {
    expect(normalizeContestKey("shift+control+r")).toBe("Ctrl+Shift+R");
    expect(contestKeyChord({ key: "ArrowUp", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe("Up");
    expect(contestKeyChord({ key: "=", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false })).toBe("Ctrl+=");
  });
});
