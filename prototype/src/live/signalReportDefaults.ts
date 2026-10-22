type Draft = Record<string, any>;

export function applyModeSignalReportDefaults(draft: Draft, mode: string): Draft {
  const normalized = mode.trim().toUpperCase();
  const previous = String(draft.mode ?? "").trim().toUpperCase();
  const submode = previous === normalized ? draft.submode : "";
  const pair = normalized === "CW" ? ["599", "59"] : normalized === "SSB" ? ["59", "599"] : null;
  if (!pair) return { ...draft, mode, submode };
  const report = (value: unknown) => !value || value === pair[1] ? pair[0] : value;
  return { ...draft, mode, submode, rstSent: report(draft.rstSent), rstReceived: report(draft.rstReceived) };
}
