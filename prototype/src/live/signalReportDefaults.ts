type Draft = Record<string, any>;

export function applyModeSignalReportDefaults(draft: Draft, mode: string): Draft {
  const normalized = mode.trim().toUpperCase();
  if (normalized !== "CW" && normalized !== "SSB") return { ...draft, mode };
  const target = normalized === "CW" ? "599" : "59";
  const replaced = normalized === "CW" ? "59" : "599";
  const report = (value: unknown) => {
    const text = String(value ?? "");
    return !text.trim() || text === replaced ? target : text;
  };
  return { ...draft, mode, rstSent: report(draft.rstSent), rstReceived: report(draft.rstReceived) };
}
