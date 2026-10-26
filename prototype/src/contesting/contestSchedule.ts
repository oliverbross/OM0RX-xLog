// Settings use UTC wall time; never interpret datetime-local values in the OS timezone.
export function contestUTC(value: unknown): string | null {
  const text = String(value ?? "").trim().replace(" ", "T");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(text)) return null;
  const normalized = text.length === 16 ? `${text}:00` : text;
  const date = new Date(`${normalized}Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === normalized ? date.toISOString() : null;
}

function cqWWPeriod(pluginID:string, year:number) {
  const month=pluginID==="cq_ww_ssb"?9:10;
  const last=new Date(Date.UTC(year,month+1,0));
  const sunday=last.getUTCDate()-last.getUTCDay();
  return {contestStartAt:new Date(Date.UTC(year,month,sunday-1)).toISOString(),
    contestEndAt:new Date(Date.UTC(year,month,sunday+1)).toISOString(),contestScheduleSource:"cq-ww-calendar" as const};
}

export function contestSchedule(pluginID: string, settings: Record<string, unknown>, lastQsoAt?:string|null) {
  const configuredStart = contestUTC(settings.StartDate);
  const explicitEnd = String(settings.EndDate ?? "").trim();
  const unknown={contestStartAt:configuredStart,contestEndAt:null};
  if (explicitEnd) {
    const end=contestUTC(explicitEnd);
    return configuredStart&&end&&end>configuredStart
      ? {contestStartAt:configuredStart,contestEndAt:end,contestScheduleSource:"settings" as const}:unknown;
  }
  if (!["cq_ww_ssb","cq_ww_cw"].includes(pluginID)) return unknown;
  // Organizer rule: last FULL weekend of October/November, 00:00 Sat to 24:00 Sun.
  // https://cqww.com/index.htm and https://cqww.com/rules/ (verified 2026-10-26).
  // Legacy StartDate can be session creation time; never add 48 hours to it.
  if (lastQsoAt) {
    const qso=new Date(lastQsoAt);
    if (!Number.isFinite(qso.getTime())||!lastQsoAt.startsWith(qso.toISOString().slice(0,19))) return unknown;
    const period=cqWWPeriod(pluginID,qso.getUTCFullYear());
    return qso.getTime()>=Date.parse(period.contestStartAt)&&qso.getTime()<Date.parse(period.contestEndAt)?period:unknown;
  }
  if (configuredStart) {
    const period=cqWWPeriod(pluginID,new Date(configuredStart).getUTCFullYear());
    if (configuredStart===period.contestStartAt) return period;
  }
  return unknown;
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
