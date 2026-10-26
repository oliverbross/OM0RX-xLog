// Settings use UTC wall time; never interpret datetime-local values in the OS timezone.
export function contestUTC(value: unknown): string | null {
  const text = String(value ?? "").trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) return null;
  const normalized = text.length === 16 ? `${text}:00` : text;
  const date = new Date(`${normalized}Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === normalized ? date.toISOString() : null;
}

export function contestSchedule(pluginID: string, settings: Record<string, unknown>) {
  const contestStartAt = contestUTC(settings.StartDate);
  const explicitEnd = String(settings.EndDate ?? "").trim();
  // CQ WW SSB/CW: 00:00 Saturday to 24:00 Sunday, https://cqww.com/rules/.
  const defaultHours = ["cq_ww_ssb", "cq_ww_cw"].includes(pluginID) ? 48 : null;
  const end = explicitEnd ? contestUTC(explicitEnd) : contestStartAt && defaultHours
    ? new Date(Date.parse(contestStartAt) + defaultHours * 3_600_000).toISOString() : null;
  return { contestStartAt, contestEndAt: contestStartAt && end && end > contestStartAt ? end : null };
}

export function durationText(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
}

export function qsoIdleColor(seconds: number | null): string | undefined {
  if (seconds === null) return undefined;
  const stops = [[18, 214, 160], [243, 178, 60], [255, 107, 94]];
  const progress = Math.max(0, Math.min(1, seconds / 900)) * 2;
  const segment = Math.min(1, Math.floor(progress)), mix = progress - segment;
  return `rgb(${stops[segment].map((value, index) => Math.round(value + (stops[segment + 1][index] - value) * mix)).join(", ")})`;
}
