type Draft = Record<string, any>;

export function applyModeSignalReportDefaults(draft: Draft, mode: string): Draft {
  const normalized = mode.trim().toUpperCase();
  const pair = normalized === "CW" ? ["599", "59"] : normalized === "SSB" ? ["59", "599"] : null;
  if (!pair) return { ...draft, mode };
  const report = (value: unknown) => !value || value === pair[1] ? pair[0] : value;
  return { ...draft, mode, rstSent: report(draft.rstSent), rstReceived: report(draft.rstReceived) };
}
