import { compileCWMessage, describeCWPlan } from "./cwMessagePlan";
/** Pure CW configuration and preview rules. This module never keys a device. */
export const cwColors = ["cyan", "green", "amber", "orange", "pink", "neutral"] as const;
export const cwShortcuts = Array.from({ length: 24 }, (_, index) => `${index >= 12 ? "Shift+" : ""}F${index % 12 + 1}`);
export const cwTokens = ["MYCALL", "CALL", "RST", "NAME", "GRID", "SERIAL", "EXCHANGE"] as const;
export type CWToken = typeof cwTokens[number];
export type CWContext = Partial<Record<CWToken, string>>;
export type CWMacro = { id: number; label: string; text: string; color: typeof cwColors[number]; shortcut: string; enabled: boolean; onDesk: boolean };
export type WinKeyerPreferences = { speedSource?: "software" | "pot"; potMinimum?: number; potRange?: number; weighting?: number; ratio?: number; pttLead?: number; pttTail?: number };
export type CWProfile = { version: 1; output: "radio" | "winkeyer"; showOnDesk: boolean; macros: CWMacro[]; winkeyer?: { port: string; wpm: number; preferences?: WinKeyerPreferences }; composition?: { mode: "character" | "word" | "hybrid" } };
export const cwOutputLimit = (output: CWProfile["output"], radioProvider: string) => output === "radio" && radioProvider === "hamlib" ? 80 : 128;
export const defaultCWProfile: CWProfile = { version: 1, output: "radio", showOnDesk: false, winkeyer: { port: "", wpm: 20 }, macros: [
  { id: 1, label: "CQ", text: "CQ CQ DE {MYCALL} {MYCALL} K", color: "cyan", shortcut: "", enabled: true, onDesk: true },
  { id: 2, label: "Call", text: "{CALL} DE {MYCALL} K", color: "green", shortcut: "", enabled: true, onDesk: true },
  { id: 3, label: "Report", text: "{CALL} {RST} {RST} K", color: "amber", shortcut: "", enabled: true, onDesk: true },
  { id: 4, label: "Again", text: "AGN PSE K", color: "orange", shortcut: "", enabled: true, onDesk: true },
  { id: 5, label: "Thank you", text: "TU {CALL} DE {MYCALL} K", color: "neutral", shortcut: "", enabled: true, onDesk: true },
] };

function templateError(text: string): string | null {
  if (!text.trim()) return "Enter CW text.";
  if (text.length > 512) return "Keep the template within 512 characters.";
  const stripped = text.replace(/\{([^{}]+)\}/g, (_, token: string) => {
    if (!cwTokens.includes(token as CWToken) && token !== "WPM:BASE" && !/^WPM:(?:[5-9]|[1-9][0-9])$/.test(token) && !/^PROSIGN:(?:AR|AS|BT|SK|KN)$/.test(token)) throw new Error(`Unknown CW placeholder: {${token}}.`);
    return "";
  });
  return /^[a-zA-Z0-9 /?=+.,\-]*$/.test(stripped) ? null : "Use letters, numbers, spaces, / ? = + . , - and the listed placeholders. Raw keyer commands and control characters are not allowed.";
}

export function validateCWProfile(value: unknown): CWProfile {
  if (!value || typeof value !== "object") throw new Error("CW settings must be an object.");
  const profile = value as CWProfile;
  if (profile.version !== 1 || !["radio", "winkeyer"].includes(profile.output) || typeof profile.showOnDesk !== "boolean" || !Array.isArray(profile.macros) || profile.macros.length > 20)
    throw new Error("Use a version 1 CW profile with at most 20 macros.");
  const ids = new Set<number>(), shortcuts = new Set<string>();
  const macros = profile.macros.map(macro => {
    if (!macro || !Number.isInteger(macro.id) || macro.id < 1 || macro.id > 20 || ids.has(macro.id)) throw new Error("Each CW macro needs a unique slot from 1 to 20.");
    ids.add(macro.id);
    if (typeof macro.label !== "string" || !macro.label.trim() || macro.label.length > 24 || /[\x00-\x1f\x7f]/.test(macro.label)) throw new Error(`Macro ${macro.id}: use a label of 1–24 characters.`);
    if (!cwColors.includes(macro.color) || typeof macro.enabled !== "boolean" || typeof macro.onDesk !== "boolean") throw new Error(`Macro ${macro.id}: invalid color or visibility.`);
    if (typeof macro.shortcut !== "string" || macro.shortcut && !cwShortcuts.includes(macro.shortcut)) throw new Error(`Macro ${macro.id}: select a listed function-key shortcut.`);
    // Duplicates are rejected even on disabled macros, avoiding ambiguity later.
    if (macro.shortcut && shortcuts.has(macro.shortcut)) throw new Error(`Shortcut ${macro.shortcut} is already assigned.`);
    if (macro.shortcut) shortcuts.add(macro.shortcut);
    if (typeof macro.text !== "string") throw new Error(`Macro ${macro.id}: enter CW text.`);
    const error = templateError(macro.text);
    if (error) throw new Error(`Macro ${macro.id}: ${error}`);
    return { id: macro.id, label: macro.label.trim(), text: macro.text, color: macro.color, shortcut: macro.shortcut, enabled: macro.enabled, onDesk: macro.onDesk };
  });
  // Whitelist the persistent fields. Arming, queued text and session ownership
  // must never survive a reload, profile import, reconnect or app restart.
  const winkeyer = profile.winkeyer ?? { port: "", wpm: 20 };
  if (typeof winkeyer.port !== "string" || winkeyer.port.length > 512 || /[\x00-\x1f\x7f]/.test(winkeyer.port) || !Number.isInteger(winkeyer.wpm) || winkeyer.wpm < 5 || winkeyer.wpm > 99)
    throw new Error("Use a valid WinKeyer port and a speed of 5–99 WPM.");
  const preferences = validateWinKeyerPreferences(winkeyer.preferences);
  if (profile.composition && !["character", "word", "hybrid"].includes(profile.composition.mode)) throw new Error("Choose character, word or hybrid CW composition.");
  return { version: 1, output: profile.output, showOnDesk: profile.showOnDesk, macros, winkeyer: { port: winkeyer.port.trim(), wpm: winkeyer.wpm, ...(preferences ? { preferences } : {}) }, ...(profile.composition ? { composition: { mode: profile.composition.mode } } : {}) };
}

export function validateWinKeyerPreferences(value: unknown): WinKeyerPreferences | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid WinKeyer preferences.");
  const p = value as WinKeyerPreferences;
  const keys = ["speedSource", "potMinimum", "potRange", "weighting", "ratio", "pttLead", "pttTail"];
  if (Object.keys(p).some(key => !keys.includes(key))) throw new Error("Unsupported WinKeyer preference.");
  const inRange = (number: number | undefined, min: number, max: number) => number === undefined || Number.isInteger(number) && number >= min && number <= max;
  if (p.speedSource !== undefined && !["software", "pot"].includes(p.speedSource)
    || (p.potMinimum === undefined) !== (p.potRange === undefined) || (p.pttLead === undefined) !== (p.pttTail === undefined)
    || !inRange(p.potMinimum, 5, 94) || !inRange(p.potRange, 5, 94) || (p.potMinimum ?? 0) + (p.potRange ?? 0) > 99
    || !inRange(p.weighting, 10, 90) || !inRange(p.ratio, 33, 66) || !inRange(p.pttLead, 0, 250) || !inRange(p.pttTail, 0, 250))
    throw new Error("Use valid paired pot/PTT ranges, weighting 10–90 and ratio 33–66.");
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as WinKeyerPreferences;
}

export function expandCWMacro(template: string, context: CWContext, maxLength = 80): string {
  const error = templateError(template);
  if (error) throw new Error(error);
  return describeCWPlan(compileCWMessage(template, context, maxLength));
}

export function macroForKey(event: KeyboardEvent, profile: CWProfile): CWMacro | undefined {
  if (event.repeat || event.isComposing || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (!(event.target instanceof Element) || event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], dialog, [role='dialog']")) return;
  const shortcut = `${event.shiftKey ? "Shift+" : ""}${event.key}`;
  return profile.macros.find(macro => macro.enabled && macro.shortcut !== "" && macro.shortcut === shortcut);
}
