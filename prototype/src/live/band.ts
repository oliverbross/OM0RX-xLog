export type BandAllocation = { name: "CW" | "Data" | "Phone"; low: number; high: number };
export type BandRange = { low: number; high: number; allocations: BandAllocation[] };

// kHz: visual guides inherited from the native band maps, not transmission permissions.
const SEGMENTS: Record<string, [number, number, number, number]> = {
  "160m": [1800, 1840, 1850, 2000], "80m": [3500, 3570, 3600, 4000],
  "60m": [5250, 5330, 5405, 5500], "40m": [7000, 7040, 7100, 7300],
  "30m": [10100, 10130, 10150, 10150], "20m": [14000, 14070, 14112, 14350],
  "17m": [18068, 18095, 18110, 18168], "15m": [21000, 21070, 21150, 21450],
  "12m": [24890, 24915, 24930, 24990], "10m": [28000, 28070, 28300, 29700],
  "6m": [50000, 50100, 50300, 54000], "2m": [144000, 144100, 144500, 148000],
  "70cm": [420000, 420100, 433000, 450000],
};

export const BAND_ORDER = Object.keys(SEGMENTS);
export const BAND_RANGES: Record<string, BandRange> = Object.fromEntries(Object.entries(SEGMENTS).map(([band, [low, cwHigh, dataHigh, high]]) => [band, {
  low, high, allocations: ([
    { name: "CW", low, high: cwHigh },
    { name: "Data", low: cwHigh, high: dataHigh },
    { name: "Phone", low: dataHigh, high },
  ] as BandAllocation[]).filter((part) => part.high > part.low),
}]));

export function bandForRadio(frequencyHz?: number): string | null {
  if (frequencyHz == null || !Number.isFinite(frequencyHz)) return null;
  const khz = frequencyHz / 1000;
  return BAND_ORDER.find((band) => khz >= BAND_RANGES[band].low && khz <= BAND_RANGES[band].high) ?? null;
}
