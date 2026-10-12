// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { defaultCWProfile, expandCWMacro, macroForKey, validateCWProfile } from "./cwMacros";
const profile = () => structuredClone(defaultCWProfile);
describe("CW macro configuration and preview (no device output)", () => {
  it("supports twenty unique customizable macros and rejects overfull or ambiguous profiles", () => {
    const value = profile();
    value.macros = Array.from({ length: 20 }, (_, i) => ({ ...value.macros[0], id: i + 1, label: `Macro ${i + 1}`, shortcut: i < 12 ? `F${i + 1}` : `Shift+F${i - 11}` }));
    expect(validateCWProfile(value).macros).toHaveLength(20);
    value.macros.push({ ...value.macros[0], id: 21 });
    expect(() => validateCWProfile(value)).toThrow(/at most 20/);
    value.macros.pop(); value.macros[1].shortcut = "F1";
    expect(() => validateCWProfile(value)).toThrow(/already assigned/);
    value.macros[1].shortcut = "F2"; value.macros[1].id = 1;
    expect(() => validateCWProfile(value)).toThrow(/unique slot/);
  });
  it("never persists arming or queued text with a valid profile", () => {
    expect(validateCWProfile({ ...profile(), armed: true, queue: ["CQ"], session: "old" })).toEqual(profile());
  });
  it("previews substitutions exactly and never silently removes unsafe characters", () => {
    expect(expandCWMacro("{CALL} de {MYCALL} {RST}  K", { CALL: "k1abc", MYCALL: "om0rx", RST: "599" })).toBe("K1ABC DE OM0RX 599 K");
    for (const text of ["CQ\nCQ", "CQ\x00", "{PTT}", "{MYCALL", "CQ <SK>"]) expect(() => expandCWMacro(text, {})).toThrow();
    expect(() => expandCWMacro("{CALL}", {})).toThrow(/Fill CALL/);
    expect(() => expandCWMacro("{CALL}", { CALL: "K1ABC\nTX" })).toThrow(/cannot send/);
    expect(() => expandCWMacro("{NAME}", { NAME: "José" })).toThrow(/cannot send/);
    expect(() => expandCWMacro("C".repeat(81), {})).toThrow(/allows 80/);
    expect(expandCWMacro("C".repeat(80), {})).toHaveLength(80);
  });
  it("ignores typing, dialogs, repeat, IME and OS-modified shortcuts", () => {
    const value = profile(); value.macros[0].shortcut = "F1";
    const send = (element: Element, init: KeyboardEventInit = {}) => {
      let found: unknown;
      element.addEventListener("keydown", event => { found = macroForKey(event as KeyboardEvent, value); }, { once: true });
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "F1", ...init }));
      return found;
    };
    const div = document.createElement("div");
    expect(send(div)).toEqual(value.macros[0]);
    for (const tag of ["input", "textarea", "select", "dialog"]) expect(send(document.createElement(tag))).toBeUndefined();
    for (const init of [{ repeat: true }, { isComposing: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }]) expect(send(div, init)).toBeUndefined();
    const editor = document.createElement("div"), nested = document.createElement("span");
    editor.setAttribute("contenteditable", "true"); editor.append(nested);
    expect(send(nested)).toBeUndefined();
    value.macros[0].enabled = false; expect(send(div)).toBeUndefined();
  });
});
