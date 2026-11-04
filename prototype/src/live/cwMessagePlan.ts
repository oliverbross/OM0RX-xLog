import type { CWContext } from "./cwMacros";

export type CWSegment = { kind: "text"; text: string } | { kind: "speed"; wpm: number } | { kind: "restore" } | { kind: "prosign"; value: string };
export type CWMessagePlan = { schema: 1; segments: CWSegment[] };
export const cwProsigns = ["AR", "AS", "BT", "SK", "KN"] as const;

/** Preview only. Native independently compiles saved text against its current context. */
export function compileCWMessage(source: string, context: CWContext, limit = 128, preserveEdges = false): CWMessagePlan {
  if (!source || source.length > 512 || !Number.isInteger(limit) || limit < 1 || limit > 128) throw new Error("Use 1–512 template characters within the output limit.");
  const segments: CWSegment[] = [];
  let rest = source, text = "", changedSpeed = false;
  const append = (value: string) => {
    if (!/^[a-zA-Z0-9 /?=+.,-]*$/.test(value)) throw new Error("This CW output cannot send these characters; raw control bytes are unavailable.");
    text = (text + value.toUpperCase()).replace(/ +/g, " ");
  };
  const flush = () => { if (text) segments.push({ kind: "text", text }); text = ""; };
  while (rest.includes("{")) {
    const start = rest.indexOf("{"); append(rest.slice(0, start));
    const end = rest.indexOf("}", start + 1);
    if (end < 0) throw new Error("Close the CW placeholder with }.");
    const token = rest.slice(start + 1, end);
    if (token.startsWith("WPM:")) {
      flush(); const value = token.slice(4);
      if (value === "BASE") { segments.push({ kind: "restore" }); changedSpeed = false; }
      else {
        if (!/^\d{1,2}$/.test(value) || Number(value) < 5 || Number(value) > 99) throw new Error("CW speed must be 5–99 WPM or BASE.");
        segments.push({ kind: "speed", wpm: Number(value) }); changedSpeed = true;
      }
    } else if (token.startsWith("PROSIGN:")) {
      const value = token.slice(8);
      if (!cwProsigns.includes(value as typeof cwProsigns[number])) throw new Error("Use a supported typed prosign: AR, AS, BT, SK or KN.");
      flush(); segments.push({ kind: "prosign", value });
    } else {
      if (!["MYCALL", "CALL", "RST", "NAME", "GRID", "SERIAL", "SENTNR", "EXCHANGE"].includes(token)) throw new Error(`Unknown CW placeholder: {${token}}.`);
      const value = (context as Record<string, string | undefined>)[token]?.trim();
      if (!value) throw new Error(`Fill ${token} before sending this message.`);
      append(value);
    }
    rest = rest.slice(end + 1);
  }
  append(rest); flush();
  if (!preserveEdges) {
    const first = segments[0], last = segments.at(-1);
    if (first?.kind === "text") first.text = first.text.trimStart();
    if (last?.kind === "text") last.text = last.text.trimEnd();
  }
  if (changedSpeed) segments.push({ kind: "restore" });
  const retained = segments.filter(segment => segment.kind !== "text" || segment.text.length > 0);
  const count = retained.reduce((sum, s) => sum + (s.kind === "text" ? s.text.length : s.kind === "prosign" ? 2 : 0), 0);
  if (!count || count > limit || retained.length > 64) throw new Error(`Expanded CW is ${count} characters; this output allows ${limit}.`);
  return { schema: 1, segments: retained };
}

export const describeCWPlan = (plan: CWMessagePlan) => plan.segments.map(segment => {
  switch (segment.kind) {
    case "text": return segment.text;
    case "speed": return `[${segment.wpm} WPM]`;
    case "restore": return "[base WPM]";
    case "prosign": return `<${segment.value}>`;
  }
}).join("");

export type CompositionMode = "character" | "word" | "hybrid";
/** Only an input handler calls this; no preference/context effect schedules output. */
export function compositionBoundary(text: string, mode: CompositionMode, firstWord: boolean): number {
  if (mode === "character") return text.length;
  if (mode === "hybrid" && firstWord) return text.includes(" ") ? text.indexOf(" ") + 1 : text.length;
  return text.lastIndexOf(" ") + 1;
}
