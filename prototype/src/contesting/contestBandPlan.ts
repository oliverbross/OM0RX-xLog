import { BAND_ORDER, BAND_RANGES, type BandAllocation } from "../live/band";

export type ContestBandMode = "cw" | "data" | "phone";
export type ContestBandPlanEntry = {
  band: string;
  cw: { low: number; high: number };
  data: { low: number; high: number };
  phone: { low: number; high: number };
};

const modeName: Record<ContestBandMode, BandAllocation["name"]> = {
  cw: "CW", data: "Data", phone: "Phone",
};

function defaultRange(band: string, mode: ContestBandMode) {
  const full = BAND_RANGES[band];
  const allocation = full?.allocations.find(item => item.name === modeName[mode]);
  // CQ WW SSB activity in Region 1 routinely extends below the normal 7.100
  // MHz phone guide. Contest plans remain operator-editable in Setup > Bands.
  if (band === "40m" && mode === "phone") return { low: 7050, high: 7200 };
  return allocation ? { low: allocation.low, high: allocation.high } : { low: full?.low ?? 0, high: full?.low ?? 0 };
}

export function defaultContestBandPlan(bands: readonly string[] = BAND_ORDER): ContestBandPlanEntry[] {
  return bands.filter(band => band in BAND_RANGES).map(band => ({
    band, cw: defaultRange(band, "cw"), data: defaultRange(band, "data"), phone: defaultRange(band, "phone"),
  }));
}

function validRange(value: unknown, band: string): value is { low: number; high: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const range = value as Record<string, unknown>, full = BAND_RANGES[band];
  return !!full && typeof range.low === "number" && Number.isFinite(range.low) &&
    typeof range.high === "number" && Number.isFinite(range.high) &&
    range.low >= full.low && range.high <= full.high && range.high >= range.low;
}

export function encodeContestBandPlan(entries: readonly ContestBandPlanEntry[]): string[] {
  return entries.map(entry => JSON.stringify(entry));
}

export function decodeContestBandPlan(value: unknown, bands: readonly string[] = BAND_ORDER): ContestBandPlanEntry[] {
  const saved = new Map<string, ContestBandPlanEntry>();
  if (Array.isArray(value)) for (const encoded of value) {
    if (typeof encoded !== "string" || encoded.length > 512) continue;
    try {
      const entry = JSON.parse(encoded) as ContestBandPlanEntry;
      if (entry && typeof entry === "object" && bands.includes(entry.band) &&
          validRange(entry.cw, entry.band) && validRange(entry.data, entry.band) && validRange(entry.phone, entry.band)) saved.set(entry.band, entry);
    } catch { /* A malformed saved row falls back to the known band defaults. */ }
  }
  return defaultContestBandPlan(bands).map(fallback => {
    const entry = saved.get(fallback.band);
    if (!entry) return fallback;
    // Migrate only the former generated 40 m phone guide. Any operator-defined
    // range remains untouched.
    if (entry.band === "40m" && entry.phone.low === 7100 && entry.phone.high === 7300)
      return { ...entry, phone:{...fallback.phone} };
    return entry;
  });
}

export function visibleContestBandRange(entry: ContestBandPlanEntry | undefined, modes: readonly ContestBandMode[]) {
  if (!entry || modes.length === 0) return entry ? BAND_RANGES[entry.band] : undefined;
  const allocations = modes.map(mode => ({ name: modeName[mode], ...entry[mode] })).filter(item => item.high > item.low);
  if (allocations.length === 0) return BAND_RANGES[entry.band];
  return {
    low: Math.min(...allocations.map(item => item.low)),
    high: Math.max(...allocations.map(item => item.high)),
    allocations,
  };
}

export function contestModeForFrequency(entry: ContestBandPlanEntry | undefined, frequencyKHz: number): ContestBandMode {
  if (!entry || !Number.isFinite(frequencyKHz)) return "phone";
  // N1MM gives Digital precedence over CW when configured segments overlap;
  // everything outside those explicit segments is treated as phone.
  if (frequencyKHz >= entry.data.low && frequencyKHz <= entry.data.high && entry.data.high > entry.data.low) return "data";
  if (frequencyKHz >= entry.cw.low && frequencyKHz <= entry.cw.high && entry.cw.high > entry.cw.low) return "cw";
  return "phone";
}

export function contestModeForSpot(entry: ContestBandPlanEntry | undefined, frequencyKHz: number,
    allowedModes: readonly ContestBandMode[], comment: unknown, reportedMode?: unknown): ContestBandMode {
  const explicit = explicitContestMode(comment);
  if (explicit) return explicit;
  // The shared cluster service already recognizes FT dial frequencies and
  // digital protocols. An overlapping contest phone range must not erase that
  // evidence merely because the packet comment omitted the mode.
  const reported = explicitContestMode(reportedMode);
  if (reported) return reported;
  if (entry && allowedModes.length === 1) {
    const mode = allowedModes[0], range = entry[mode];
    if (range.high > range.low && frequencyKHz >= range.low && frequencyKHz <= range.high) return mode;
  }
  return contestModeForFrequency(entry, frequencyKHz);
}

export function explicitContestMode(comment: unknown): ContestBandMode | null {
  const value = typeof comment === "string" ? comment.toUpperCase() : "";
  if (/\b(?:RTTY|JTTY|PKTLSB|PKTUSB|(?:USB|LSB|AM|FM)-D|DIGI-[UL]|FT-?[248]|PSK(?:-?\d+)?|JT-?(?:65|9)|Q65[A-D]?|OLIVIA|HELL|MFSK|SSTV|DIGI(?:TAL)?|DATA)\b/.test(value)) return "data";
  if (/\b(?:CW|CWR)\b/.test(value)) return "cw";
  if (/\b(?:SSB|USB|LSB|PHONE|AM|FM|NFM)\b/.test(value)) return "phone";
  return null;
}

export function contestSpotWithinModeRange(entry:ContestBandPlanEntry|undefined,frequencyKHz:number,mode:ContestBandMode):boolean {
  if(!entry)return true;
  const range=entry[mode];
  return Number.isFinite(frequencyKHz)&&range.high>range.low&&frequencyKHz>=range.low&&frequencyKHz<=range.high;
}
