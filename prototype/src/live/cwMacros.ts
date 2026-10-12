/** Pure CW configuration and preview rules. This module never keys a device. */
export const cwColors = ["cyan", "green", "amber", "orange", "pink", "neutral"] as const;
export const cwShortcuts = Array.from({ length: 24 }, (_, index) => `${index >= 12 ? "Shift+" : ""}F${index % 12 + 1}`);
export const cwTokens = ["MYCALL", "CALL", "RST", "NAME", "GRID", "SERIAL"] as const;
export type CWToken = typeof cwTokens[number];
export type CWContext = Partial<Record<CWToken, string>>;
export type CWMacro = { id: number; label: string; text: string; color: typeof cwColors[number]; shortcut: string; enabled: boolean; onDesk: boolean };
export type CWProfile = { version: 1; output: "radio" | "winkeyer"; showOnDesk: boolean; macros: CWMacro[] };
export const defaultCWProfile: CWProfile = { version: 1, output: "radio", showOnDesk: false, macros: [
  { id: 1, label: "CQ", text: "CQ CQ DE {MYCALL} {MYCALL} K", color: "cyan", shortcut: "", enabled: true, onDesk: true },
  { id: 2, label: "Call", text: "{CALL} DE {MYCALL} K", color: "green", shortcut: "", enabled: true, onDesk: true },
  { id: 3, label: "Report", text: "{CALL} {RST} {RST} K", color: "amber", shortcut: "", enabled: true, onDesk: true },
  { id: 4, label: "Again", text: "AGN PSE K", color: "orange", shortcut: "", enabled: true, onDesk: true },
  { id: 5, label: "Thank you", text: "TU {CALL} DE {MYCALL} K", color: "neutral", shortcut: "", enabled: true, onDesk: true },
] };

function templateError(text: string): string | null {
  if (!text.trim()) return "Enter CW text.";
  if (text.length > 512) return "Keep the template within 512 characters.";
  const stripped = text.replace(/\{([A-Z]+)\}/g, (_, token: string) => {
    if (!cwTokens.includes(token as CWToken)) throw new Error(`Unknown CW placeholder: {${token}}.`);
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
  return { version: 1, output: profile.output, showOnDesk: profile.showOnDesk, macros };
}

export function expandCWMacro(template: string, context: CWContext, maxLength = 80): string {
  const error = templateError(template);
  if (error) throw new Error(error);
  if (!Number.isInteger(maxLength) || maxLength < 1 || maxLength > 128) throw new Error("Invalid CW output length limit.");
  const text = template.replace(/\{([A-Z]+)\}/g, (_, token: CWToken) => {
    const value = context[token]?.trim();
    if (!value) throw new Error(`Fill ${token} before sending this macro.`);
    // Validate replacements too: a callsign/name cannot inject raw device bytes
    // or a second template, and non-ASCII characters are not silently dropped.
    if (!/^[a-zA-Z0-9 /?=+.,\-]+$/.test(value)) throw new Error(`${token} contains characters this CW output cannot send.`);
    return value;
  }).trim().replace(/ +/g, " ").toUpperCase();
  if (text.length > maxLength) throw new Error(`Expanded CW is ${text.length} characters; this output allows ${maxLength}. Shorten the macro.`);
  return text;
}

export function macroForKey(event: KeyboardEvent, profile: CWProfile): CWMacro | undefined {
  if (event.repeat || event.isComposing || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  if (!(event.target instanceof Element) || event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox'], dialog, [role='dialog']")) return;
  const shortcut = `${event.shiftKey ? "Shift+" : ""}${event.key}`;
  return profile.macros.find(macro => macro.enabled && macro.shortcut !== "" && macro.shortcut === shortcut);
}
