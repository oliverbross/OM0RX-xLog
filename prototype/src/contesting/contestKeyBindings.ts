export const contestKeyBindingContexts = ["*", "Callsign", "Report", "Exchange", "Other 1", "Other 2"] as const;
export type ContestKeyBindingContext = typeof contestKeyBindingContexts[number];

export const contestFunctionKeyActions = ["SEND_F1", "SEND_F2", "SEND_F3", "SEND_F4", "SEND_F5", "SEND_F6",
  "SEND_F7", "SEND_F8", "SEND_F9", "SEND_F10", "SEND_F11", "SEND_F12"] as const;
export type ContestFunctionKeyAction = typeof contestFunctionKeyActions[number];

export const contestKeyBindingActions = ["TOGGLE_RUN", "SET_RUN", "SET_S_AND_P", "LOG_NOW", "CLEAR_INPUTS",
  "PREV_SPOT", "NEXT_SPOT", "PREV_MULTIPLIER", "NEXT_MULTIPLIER", "QUICK_EDIT", "SPOT_DX", "MARK_SPOT", "TUNE_SPOT", "FOCUS_CALLSIGN", "FOCUS_NEXT", "FOCUS_PREVIOUS", "CW_SPEED_UP", "CW_SPEED_DOWN",
  "TOGGLE_CW_INPUT", "RST_INCR", "RST_DECR", "EXCH_INCR", "EXCH_DECR",
  "WIN_BAND", "WIN_CHECK", "WIN_LOG", "WIN_RATE", "WIN_STATS", "WIN_VFO", "VFO_UP", "VFO_DOWN", "RETURN_CQ_FREQUENCY",
  ...contestFunctionKeyActions] as const;
export type ContestKeyBindingAction = typeof contestKeyBindingActions[number];

export type ContestKeyBinding = {
  context: ContestKeyBindingContext;
  key: string;
  action: ContestKeyBindingAction;
};

export const contestKeyBindingDescriptions: Record<ContestKeyBindingAction, string> = {
  TOGGLE_RUN: "Toggle between RUN and S&P",
  SET_RUN: "Switch to RUN",
  SET_S_AND_P: "Switch to S&P",
  LOG_NOW: "Log the current contact",
  CLEAR_INPUTS: "Clear all input fields",
  PREV_SPOT: "Jump to the previous spot in the bandmap",
  NEXT_SPOT: "Jump to the next spot in the bandmap",
  PREV_MULTIPLIER: "Jump to the previous needed multiplier by frequency",
  NEXT_MULTIPLIER: "Jump to the next needed multiplier by frequency",
  QUICK_EDIT: "Edit the last logged contact",
  SPOT_DX: "Spot the current callsign to the cluster",
  MARK_SPOT: "Mark or unmark the current callsign to work later",
  TUNE_SPOT: "Tune to the selected spot or a callsign match",
  FOCUS_CALLSIGN: "Move focus to the callsign field",
  FOCUS_NEXT: "Move focus to the next contest field",
  FOCUS_PREVIOUS: "Move focus to the previous contest field",
  CW_SPEED_UP: "Increase CW sending speed",
  CW_SPEED_DOWN: "Decrease CW sending speed",
  TOGGLE_CW_INPUT: "Toggle the free-form CW input",
  RST_INCR: "Increase the focused RST",
  RST_DECR: "Decrease the focused RST",
  EXCH_INCR: "Increase the focused numeric exchange",
  EXCH_DECR: "Decrease the focused numeric exchange",
  WIN_BAND: "Toggle the Band Map window",
  WIN_CHECK: "Toggle the Check Partial window",
  WIN_LOG: "Toggle the QSO Log window",
  WIN_RATE: "Toggle the Rate window",
  WIN_STATS: "Toggle the Statistics window",
  WIN_VFO: "Toggle the VFO window",
  VFO_UP: "Increase VFO frequency by the mode step",
  VFO_DOWN: "Decrease VFO frequency by the mode step",
  RETURN_CQ_FREQUENCY: "Return to the last confirmed CQ frequency",
  SEND_F1: "Send the F1 function macro",
  SEND_F2: "Send the F2 function macro",
  SEND_F3: "Send the F3 function macro",
  SEND_F4: "Send the F4 function macro",
  SEND_F5: "Send the F5 function macro",
  SEND_F6: "Send the F6 function macro",
  SEND_F7: "Send the F7 function macro",
  SEND_F8: "Send the F8 function macro",
  SEND_F9: "Send the F9 function macro",
  SEND_F10: "Send the F10 function macro",
  SEND_F11: "Send the F11 function macro",
  SEND_F12: "Send the F12 function macro",
};

// This is the finite subset of the pinned Not1MM defaults whose behavior is
// currently owned by the Main Logging window. Descriptions are derived rather
// than persisted, matching Not1MM's key-to-action preference representation.
const previousCoreDefaultContestKeyBindings: ContestKeyBinding[] = [
  { context: "*", key: "Ctrl+R", action: "TOGGLE_RUN" },
  { context: "*", key: "Ctrl+L", action: "LOG_NOW" },
  { context: "*", key: "Ctrl+=", action: "LOG_NOW" },
  { context: "Callsign", key: "Up", action: "PREV_SPOT" },
  { context: "Callsign", key: "Down", action: "NEXT_SPOT" },
  { context: "*", key: "Ctrl+S", action: "SPOT_DX" },
  { context: "*", key: "Ctrl+M", action: "MARK_SPOT" },
  { context: "*", key: "Ctrl+G", action: "TUNE_SPOT" },
  { context: "*", key: "PgUp", action: "CW_SPEED_UP" },
  { context: "*", key: "PgDown", action: "CW_SPEED_DOWN" },
  { context: "*", key: "Ctrl+W", action: "CLEAR_INPUTS" },
];
export const defaultContestKeyBindings: ContestKeyBinding[] = [
  ...previousCoreDefaultContestKeyBindings,
  { context: "*", key: "Alt+B", action: "WIN_BAND" },
  { context: "*", key: "Alt+C", action: "WIN_CHECK" },
  { context: "*", key: "Alt+L", action: "WIN_LOG" },
  { context: "*", key: "Alt+R", action: "WIN_RATE" },
  { context: "*", key: "Alt+S", action: "WIN_STATS" },
  { context: "*", key: "Alt+V", action: "WIN_VFO" },
  { context: "*", key: "Alt+.", action: "VFO_UP" },
  { context: "*", key: "Alt+,", action: "VFO_DOWN" },
  { context: "*", key: "Ctrl+Shift+K", action: "TOGGLE_CW_INPUT" },
  { context: "*", key: "Ctrl+Q", action: "RETURN_CQ_FREQUENCY" },
];

export function functionKeyForContestAction(action: ContestKeyBindingAction): `F${number}` | null {
  return action.startsWith("SEND_F") ? action.slice("SEND_".length) as `F${number}` : null;
}

// Opt-in profile; existing/custom bindings are never silently replaced.
export const n1mmContestKeyBindings:ContestKeyBinding[]=[
  {context:"*",key:"Ctrl+Up",action:"PREV_SPOT"},
  {context:"*",key:"Ctrl+Down",action:"NEXT_SPOT"},
  {context:"*",key:"Ctrl+Alt+Up",action:"PREV_MULTIPLIER"},
  {context:"*",key:"Ctrl+Alt+Down",action:"NEXT_MULTIPLIER"},
  {context:"*",key:"Ctrl+Q",action:"QUICK_EDIT"},
  {context:"*",key:"Alt+Q",action:"RETURN_CQ_FREQUENCY"},
  {context:"*",key:"Ctrl+W",action:"CLEAR_INPUTS"},
  {context:"*",key:"Ctrl+R",action:"TOGGLE_RUN"},
  {context:"*",key:"Ctrl+L",action:"LOG_NOW"},
];

const contextSet = new Set<string>(contestKeyBindingContexts);
const actionSet = new Set<string>(contestKeyBindingActions);
const reservedBaseKeys = new Set(["Esc", "Enter", "Tab", ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`)]);
const modifierOrder = ["Ctrl", "Alt", "Shift", "Meta"] as const;

function baseKey(value: string): string | null {
  const key = value.trim();
  if (!key) return null;
  const aliases: Record<string, string> = {
    arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right",
    escape: "Esc", esc: "Esc", pageup: "PgUp", pagedown: "PgDown", " ": "Space", spacebar: "Space",
  };
  const aliased = aliases[key.toLowerCase()];
  if (aliased) return aliased;
  if (/^f(?:[1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  if (key.length === 1 && /[a-z]/i.test(key)) return key.toUpperCase();
  if (key.length === 1 || /^[A-Za-z][A-Za-z0-9]*$/.test(key)) return key;
  return null;
}

export function normalizeContestKey(value: string): string | null {
  const parts = value.split("+").map(item => item.trim()).filter(Boolean);
  if (!parts.length) return null;
  const base = baseKey(parts.at(-1) ?? "");
  if (!base) return null;
  const modifiers = new Set<string>();
  for (const raw of parts.slice(0, -1)) {
    const canonical = raw.toLowerCase() === "control" || raw.toLowerCase() === "ctrl" ? "Ctrl"
      : raw.toLowerCase() === "option" || raw.toLowerCase() === "alt" ? "Alt"
      : raw.toLowerCase() === "shift" ? "Shift"
      : raw.toLowerCase() === "command" || raw.toLowerCase() === "cmd" || raw.toLowerCase() === "meta" ? "Meta" : null;
    if (!canonical || modifiers.has(canonical)) return null;
    modifiers.add(canonical);
  }
  return [...modifierOrder.filter(item => modifiers.has(item)), base].join("+");
}

function decodedRows(value: unknown): ContestKeyBinding[] | null {
  let parsed = value;
  if (typeof parsed === "string") {
    if (!parsed.trim()) return null;
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  if (Array.isArray(parsed)) {
    const rows: ContestKeyBinding[] = [];
    for (const item of parsed) {
      if (Array.isArray(item) && item.length === 3 && item.every(part => typeof part === "string"))
        rows.push({ context: item[0] as ContestKeyBindingContext, key: item[1], action: item[2] as ContestKeyBindingAction });
      else if (item && typeof item === "object") {
        const row = item as Record<string, unknown>;
        if (typeof row.context !== "string" || typeof row.key !== "string" || typeof row.action !== "string") return null;
        rows.push({ context: row.context as ContestKeyBindingContext, key: row.key, action: row.action as ContestKeyBindingAction });
      } else return null;
    }
    return rows;
  }
  if (parsed && typeof parsed === "object") {
    const rows: ContestKeyBinding[] = [];
    for (const [contextKey, action] of Object.entries(parsed)) {
      if (typeof action !== "string") return null;
      const separator = contextKey.indexOf(":");
      const context = separator < 0 ? "*" : contextKey.slice(0, separator);
      const key = separator < 0 ? contextKey : contextKey.slice(separator + 1);
      rows.push({ context: context as ContestKeyBindingContext, key, action: action as ContestKeyBindingAction });
    }
    return rows;
  }
  return null;
}

export function readContestKeyBindings(value: unknown): ContestKeyBinding[] {
  const rows = decodedRows(value);
  if (!rows) return structuredClone(defaultContestKeyBindings);
  const exactDefaults = (defaults: readonly ContestKeyBinding[], legacyTune: boolean) => rows.length === defaults.length && rows.every((row,index) => {
    const item=defaults[index];
    return item.context===row.context&&item.action===row.action&&
      (legacyTune&&row.action==="TUNE_SPOT"?row.key==="Ctrl+T"&&item.key==="Ctrl+G":item.key===row.key);
  });
  const previousDefaults = exactDefaults(previousCoreDefaultContestKeyBindings, false) || exactDefaults(previousCoreDefaultContestKeyBindings, true) ||
    exactDefaults(defaultContestKeyBindings.slice(0, -2), false) || exactDefaults(defaultContestKeyBindings.slice(0, -2), true);
  const legacyDefaults = exactDefaults(defaultContestKeyBindings, true);
  const migrated = previousDefaults ? structuredClone(defaultContestKeyBindings) : legacyDefaults
    ? rows.map(row => row.action === "TUNE_SPOT" && row.key === "Ctrl+T" ? { ...row, key: "Ctrl+G" } : row) : rows;
  const supported = migrated.flatMap(row => {
    const action = (row.action as string) === "WIPE" ? "CLEAR_INPUTS" : row.action;
    return contextSet.has(row.context) && actionSet.has(action)
      ? [{ context: row.context, key: row.key, action: action as ContestKeyBindingAction }] : [];
  });
  return supported;
}

export function validateContestKeyBindings(value: unknown): ContestKeyBinding[] {
  const rows = decodedRows(value);
  if (!rows) throw new Error("Key bindings must use the supported Not1MM key format.");
  if (rows.length > 32) throw new Error("At most 32 key bindings are supported.");
  const seen = new Set<string>();
  const normalized = rows.map(row => {
    if (!contextSet.has(row.context)) throw new Error(`Unsupported key context: ${row.context || "blank"}.`);
    if (!actionSet.has(row.action)) throw new Error(`Unsupported key action: ${row.action || "blank"}.`);
    const key = normalizeContestKey(row.key);
    if (!key) throw new Error("Each key binding needs one valid key combination.");
    const base = key.split("+").at(-1) ?? "";
    if (reservedBaseKeys.has(base)) throw new Error(`${base} remains reserved for contest safety and operator workflow.`);
    const identity = `${row.context}:${key}`;
    if (seen.has(identity)) throw new Error(`Duplicate key binding: ${identity}.`);
    seen.add(identity);
    return { context: row.context, key, action: row.action };
  });
  const encoded = encodeContestKeyBindings(normalized);
  if (new TextEncoder().encode(encoded).length > 512) throw new Error("Key bindings exceed the contest preference limit.");
  return normalized;
}

export function encodeContestKeyBindings(bindings: readonly ContestKeyBinding[]): string {
  const rows = bindings.map(item => [item.context, item.key, item.action]);
  const encodedRows = JSON.stringify(rows);
  if (new TextEncoder().encode(encodedRows).length <= 512) return encodedRows;
  const identities = bindings.map(item => `${item.context}:${item.key}`);
  if (new Set(identities).size !== identities.length) return encodedRows;
  return JSON.stringify(Object.fromEntries(bindings.map(item => [
    item.context === "*" ? item.key : `${item.context}:${item.key}`, item.action,
  ])));
}

export function contestKeyChord(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"> & { code?: string }): string | null {
  // macOS Option produces glyphs (for example Option-B is ∫ and Option-. is ≥).
  // Use the physical code only for Alt chords so editable Not1MM shortcuts
  // remain stable without changing ordinary text-entry semantics.
  const physical = event.altKey && event.code ? /^Key[A-Z]$/.test(event.code) ? event.code.slice(3)
    : event.code === "Comma" ? "," : event.code === "Period" ? "." : null : null;
  const base = baseKey(physical ?? event.key);
  if (!base) return null;
  return [...modifierOrder.filter(item => item === "Ctrl" ? event.ctrlKey : item === "Alt" ? event.altKey
    : item === "Shift" ? event.shiftKey : event.metaKey), base].join("+");
}

export function resolveContestKeyBinding(bindings: readonly ContestKeyBinding[], context: ContestKeyBindingContext,
  chord: string): ContestKeyBindingAction | null {
  return bindings.find(item => item.context === context && item.key === chord)?.action
    ?? (context === "Other 1" || context === "Other 2" ? bindings.find(item => item.context === "Exchange" && item.key === chord)?.action : null)
    ?? bindings.find(item => item.context === "*" && item.key === chord)?.action ?? null;
}
