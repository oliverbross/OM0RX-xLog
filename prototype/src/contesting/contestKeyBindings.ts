export const contestKeyBindingContexts = ["*", "Callsign", "Report", "Exchange", "Other 1", "Other 2"] as const;
export type ContestKeyBindingContext = typeof contestKeyBindingContexts[number];

export const contestKeyBindingActions = ["TOGGLE_RUN", "LOG_NOW", "CLEAR_INPUTS", "PREV_SPOT", "NEXT_SPOT"] as const;
export type ContestKeyBindingAction = typeof contestKeyBindingActions[number];

export type ContestKeyBinding = {
  context: ContestKeyBindingContext;
  key: string;
  action: ContestKeyBindingAction;
};

export const contestKeyBindingDescriptions: Record<ContestKeyBindingAction, string> = {
  TOGGLE_RUN: "Toggle between RUN and S&P",
  LOG_NOW: "Log the current contact",
  CLEAR_INPUTS: "Clear all input fields",
  PREV_SPOT: "Jump to the previous spot in the bandmap",
  NEXT_SPOT: "Jump to the next spot in the bandmap",
};

// This is the finite subset of the pinned Not1MM defaults whose behavior is
// currently owned by the Main Logging window. Descriptions are derived rather
// than persisted, matching Not1MM's key-to-action preference representation.
export const defaultContestKeyBindings: ContestKeyBinding[] = [
  { context: "*", key: "Ctrl+R", action: "TOGGLE_RUN" },
  { context: "*", key: "Ctrl+L", action: "LOG_NOW" },
  { context: "*", key: "Ctrl+=", action: "LOG_NOW" },
  { context: "Callsign", key: "Up", action: "PREV_SPOT" },
  { context: "Callsign", key: "Down", action: "NEXT_SPOT" },
  { context: "*", key: "Ctrl+W", action: "CLEAR_INPUTS" },
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
  const supported = rows.flatMap(row => {
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
  return JSON.stringify(bindings.map(item => [item.context, item.key, item.action]));
}

export function contestKeyChord(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): string | null {
  const base = baseKey(event.key);
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
