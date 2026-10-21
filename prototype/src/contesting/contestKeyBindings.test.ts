import { describe, expect, it } from "vitest";
import { contestFunctionKeyActions, contestKeyBindingActions, contestKeyChord, defaultContestKeyBindings, encodeContestKeyBindings,
  functionKeyForContestAction, normalizeContestKey,
  readContestKeyBindings, resolveContestKeyBinding, validateContestKeyBindings } from "./contestKeyBindings";

describe("contest key bindings", () => {
  it("stores the supported pinned Not1MM defaults inside the host preference limit", () => {
    const encoded = encodeContestKeyBindings(defaultContestKeyBindings);
    expect(new TextEncoder().encode(encoded).length).toBeLessThanOrEqual(512);
    expect(validateContestKeyBindings(encoded)).toEqual(defaultContestKeyBindings);
  });

  it("offers only implemented operator actions and maps each function macro exactly", () => {
    expect(contestKeyBindingActions).toEqual(expect.arrayContaining([
      "SET_RUN", "SET_S_AND_P", "FOCUS_CALLSIGN", "FOCUS_NEXT", "FOCUS_PREVIOUS", "CW_SPEED_UP", "CW_SPEED_DOWN",
      "SPOT_DX", "MARK_SPOT", "TUNE_SPOT",
    ]));
    expect(contestFunctionKeyActions.map(functionKeyForContestAction)).toEqual(
      Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
    );
    expect(functionKeyForContestAction("LOG_NOW")).toBeNull();
    expect(contestKeyBindingActions).not.toEqual(expect.arrayContaining(["VFO_UP", "ROTATE"]));
    expect(defaultContestKeyBindings).toEqual(expect.arrayContaining([
      {context:"*",key:"Ctrl+S",action:"SPOT_DX"},{context:"*",key:"Ctrl+M",action:"MARK_SPOT"},
      {context:"*",key:"Ctrl+G",action:"TUNE_SPOT"},
    ]));
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
    const legacyDefaults=defaultContestKeyBindings.map(row=>row.action==="TUNE_SPOT"?{...row,key:"Ctrl+T"}:row);
    expect(readContestKeyBindings(encodeContestKeyBindings(legacyDefaults))).toEqual(defaultContestKeyBindings);
    expect(readContestKeyBindings(encodeContestKeyBindings([{context:"*",key:"Ctrl+T",action:"TUNE_SPOT"}]))).toEqual([
      {context:"*",key:"Ctrl+T",action:"TUNE_SPOT"},
    ]);
    const customizedDefaults=legacyDefaults.map(row=>row.action==="TUNE_SPOT"?{...row,key:"Alt+G"}:row);
    expect(readContestKeyBindings(encodeContestKeyBindings(customizedDefaults))).toEqual(customizedDefaults);
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
