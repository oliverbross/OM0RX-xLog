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
      "TOGGLE_CW_INPUT", "RST_INCR", "RST_DECR", "EXCH_INCR", "EXCH_DECR",
      "SPOT_DX", "MARK_SPOT", "TUNE_SPOT",
    ]));
    expect(contestFunctionKeyActions.map(functionKeyForContestAction)).toEqual(
      Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
    );
    expect(functionKeyForContestAction("LOG_NOW")).toBeNull();
    expect(contestKeyBindingActions).not.toEqual(expect.arrayContaining(["ROTATE"]));
    expect(defaultContestKeyBindings).toEqual(expect.arrayContaining([
      {context:"*",key:"Ctrl+S",action:"SPOT_DX"},{context:"*",key:"Ctrl+M",action:"MARK_SPOT"},
      {context:"*",key:"Ctrl+G",action:"TUNE_SPOT"},
      {context:"*",key:"Alt+B",action:"WIN_BAND"},{context:"*",key:"Alt+C",action:"WIN_CHECK"},
      {context:"*",key:"Alt+L",action:"WIN_LOG"},{context:"*",key:"Alt+R",action:"WIN_RATE"},
      {context:"*",key:"Alt+S",action:"WIN_STATS"},{context:"*",key:"Alt+V",action:"WIN_VFO"},
      {context:"*",key:"Alt+.",action:"VFO_UP"},{context:"*",key:"Alt+,",action:"VFO_DOWN"},
  {context:"*",key:"Ctrl+Shift+K",action:"TOGGLE_CW_INPUT"},
  {context:"*",key:"Ctrl+Q",action:"RETURN_CQ_FREQUENCY"},
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
    ]))).toEqual([{ context: "*", key: "Ctrl+W", action: "CLEAR_INPUTS" },
      { context: "*", key: "Ctrl+Shift+K", action: "TOGGLE_CW_INPUT" }]);
    const legacyDefaults=defaultContestKeyBindings.map(row=>row.action==="TUNE_SPOT"?{...row,key:"Ctrl+T"}:row);
    expect(readContestKeyBindings(encodeContestKeyBindings(legacyDefaults))).toEqual(defaultContestKeyBindings);
    expect(readContestKeyBindings(encodeContestKeyBindings([{context:"*",key:"Ctrl+T",action:"TUNE_SPOT"}]))).toEqual([
      {context:"*",key:"Ctrl+T",action:"TUNE_SPOT"},
    ]);
    const customizedDefaults=legacyDefaults.map(row=>row.action==="TUNE_SPOT"?{...row,key:"Alt+G"}:row);
    expect(readContestKeyBindings(encodeContestKeyBindings(customizedDefaults))).toEqual(customizedDefaults);
    const duplicateDefaults=[...defaultContestKeyBindings];duplicateDefaults[1]=duplicateDefaults[0];
    expect(readContestKeyBindings(encodeContestKeyBindings(duplicateDefaults))).toEqual(duplicateDefaults);
    expect(readContestKeyBindings(encodeContestKeyBindings(defaultContestKeyBindings.slice(0, 11)))).toEqual(defaultContestKeyBindings);
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
    expect(contestKeyChord({ key: "∫", code: "KeyB", ctrlKey: false, altKey: true, shiftKey: false, metaKey: false })).toBe("Alt+B");
    expect(contestKeyChord({ key: "≥", code: "Period", ctrlKey: false, altKey: true, shiftKey: false, metaKey: false })).toBe("Alt+.");
    expect(contestKeyChord({ key: "≤", code: "Comma", ctrlKey: false, altKey: true, shiftKey: false, metaKey: false })).toBe("Alt+,");
  });
});
