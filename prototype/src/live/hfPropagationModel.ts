export const propagationBands = [
  { key: "2200m", label: "2200 m", mhz: 0.136, wspr: -1 },
  { key: "630m", label: "630 m", mhz: 0.475, wspr: 0 },
  { key: "160m", label: "160 m", mhz: 1.836, wspr: 1 },
  { key: "80m", label: "80 m", mhz: 3.568, wspr: 3 },
  { key: "60m", label: "60 m", mhz: 5.364, wspr: 5 },
  { key: "40m", label: "40 m", mhz: 7.038, wspr: 7 },
  { key: "30m", label: "30 m", mhz: 10.138, wspr: 10 },
  { key: "20m", label: "20 m", mhz: 14.095, wspr: 14 },
  { key: "17m", label: "17 m", mhz: 18.104, wspr: 18 },
  { key: "15m", label: "15 m", mhz: 21.094, wspr: 21 },
  { key: "12m", label: "12 m", mhz: 24.924, wspr: 24 },
  { key: "10m", label: "10 m", mhz: 28.124, wspr: 28 },
  { key: "6m", label: "6 m", mhz: 50.293, wspr: 50 },
  { key: "4m", label: "4 m", mhz: 70.091, wspr: 70 },
  { key: "2m", label: "2 m", mhz: 144.489, wspr: 144 },
  { key: "70cm", label: "70 cm", mhz: 432.3, wspr: 432 },
  { key: "23cm", label: "23 cm", mhz: 1296.5, wspr: 1296 },
  { key: "13cm", label: "13 cm", mhz: 2320, wspr: null },
  { key: "9cm", label: "9 cm", mhz: 3400, wspr: null },
  { key: "6cm", label: "6 cm", mhz: 5670, wspr: null },
  { key: "3cm", label: "3 cm", mhz: 10360, wspr: null },
  { key: "1_25cm", label: "1.25 cm", mhz: 24048, wspr: null },
] as const;

export const propagationModes = ["CW", "SSB", "RTTY", "FT4", "FT8", "WSPR", "OTHER"] as const;
export const propagationSources = ["wspr", "pskr", "rbn", "cluster"] as const;
export const continents = ["EU", "NA", "SA", "AS", "AF", "OC"] as const;
export type PropagationMode = typeof propagationModes[number];
export type PropagationSource = typeof propagationSources[number];
export type Continent = typeof continents[number];
export type PropagationSettings = {
  version: 1; mode: "DX" | "CONTEST"; ownCall: string; locator: string;
  bands: string[]; enabledSources: PropagationSource[];
  matrixModes: PropagationMode[]; chartModes: PropagationMode[];
};
export type PropagationSpot = { time: number; tx: string; rx: string; band: string; mode: PropagationMode;
  source: PropagationSource; txContinent: Continent | null; rxContinent: Continent | null; distance: number; count?: number };
export type OwnWSPRSpot = { time: number; band: string; kind: "tx" | "rx"; other: string; continent: Continent | null; snr: number };
export type KpPoint = { time: number; kp: number; predicted: boolean };
export type SolarConditions = { sfi: number | null; ssn: number | null; aIndex: number | null; kp: number | null;
  xray: string; solarWind: number | null; kpSeries: KpPoint[]; forecast: { geomagnetic: string; radiation: string; blackout: string } };

export const contestBands = ["160m", "80m", "40m", "20m", "15m", "10m"];
export const defaultDXBands = ["160m", "80m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"];
export const defaultPropagationSettings = (ownCall = "", locator = ""): PropagationSettings => ({
  version: 1, mode: "DX", ownCall: cleanCall(ownCall), locator: cleanLocator(locator), bands: [...defaultDXBands],
  enabledSources: [...propagationSources], matrixModes: [...propagationModes], chartModes: [...propagationModes],
});

export function cleanCall(value: unknown) { return typeof value === "string" ? value.toUpperCase().replace(/[^A-Z0-9/]/g, "").slice(0, 16) : ""; }
export function cleanLocator(value: unknown) {
  if (typeof value !== "string") return "";
  const input = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8), patterns = [/[A-R]/, /[A-R]/, /\d/, /\d/, /[A-X]/, /[A-X]/, /\d/, /\d/];
  let out = ""; for (let index = 0; index < input.length; index++) { if (!patterns[index]?.test(input[index])) break; out += input[index]; }
  return out;
}
const allowedBands = new Set<string>(propagationBands.map(band => band.key));
const allowedSources = new Set<string>(propagationSources);
const allowedModes = new Set<string>(propagationModes);
export function readPropagationSettings(raw: string | null, ownCall = "", locator = ""): PropagationSettings {
  const fallback = defaultPropagationSettings(ownCall, locator);
  if (!raw || raw.length > 8192) return fallback;
  try {
    const value = JSON.parse(raw) as Partial<PropagationSettings>;
    if (!value || value.version !== 1) return fallback;
    const mode = value.mode === "CONTEST" ? "CONTEST" : "DX";
    const bands = mode === "CONTEST" ? contestBands : Array.isArray(value.bands) ? value.bands.filter(item => allowedBands.has(item)) : fallback.bands;
    return { version: 1, mode, ownCall: cleanCall(value.ownCall || ownCall), locator: cleanLocator(value.locator || locator),
      bands: bands.length ? [...new Set(bands)] : fallback.bands,
      enabledSources: filterEnum(value.enabledSources, allowedSources, fallback.enabledSources),
      matrixModes: filterEnum(value.matrixModes, allowedModes, fallback.matrixModes),
      chartModes: filterEnum(value.chartModes, allowedModes, fallback.chartModes) };
  } catch { return fallback; }
}
function filterEnum<T extends string>(value: unknown, allowed: Set<string>, fallback: T[]): T[] {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.filter((item): item is T => typeof item === "string" && allowed.has(item)))];
}

export function normalizedMode(value: unknown): PropagationMode {
  const mode = String(value || "").toUpperCase();
  if (mode === "USB" || mode === "LSB" || mode === "PHONE") return "SSB";
  if (mode.includes("FT8")) return "FT8";
  if (mode.includes("FT4")) return "FT4";
  if (mode.includes("RTTY")) return "RTTY";
  if (mode.includes("WSPR")) return "WSPR";
  if (mode.includes("CW")) return "CW";
  if (mode.includes("SSB")) return "SSB";
  return "OTHER";
}
export function bandFromFrequency(khz: number): string | null {
  if (!Number.isFinite(khz) || khz <= 0) return null;
  const mhz = khz / 1000;
  let best: typeof propagationBands[number] | null = null, delta = Infinity;
  for (const band of propagationBands) { const next = Math.abs(band.mhz - mhz); if (next < delta) { best = band; delta = next; } }
  return best && delta <= Math.max(.05, best.mhz * .025) ? best.key : null;
}

const continentPrefixes: Record<Continent, string[]> = {
  EU: ["4U1V","TA1","CT","CU","EA","EI","ER","ES","EU","F","G","GM","GW","HA","HB","I","IS","LA","LX","LY","LZ","OE","OH","OK","OM","ON","OZ","PA","R","S5","SM","SP","SV","T7","TF","UA","YL","YO","YU","Z3","9A","9H"],
  NA: ["CY0","CY9","FG","FJ","FM","FP","FS","HH","HI","HK0","HP","HR","J3","J6","J7","J8","K","N","PJ2","PJ4","PJ5","PJ6","PJ7","TG","TI","V2","V3","V4","VE","VO","VP2","VP5","VP9","W","XE","ZF","6Y","8P"],
  SA: ["CE","CP","CX","FY","HC","HK","LU","OA","P4","PJ8","PP","PY","PZ","YV","ZP","3G","4M","8R"],
  AS: ["A4","A5","A6","A7","A9","AP","BV","BY","HL","HS","HZ","JA","JD1","JT","JY","OD","P5","S2","TA","UA0","UN","VR2","VU","XU","XV","XZ","YB","YK","4J","4K","4L","4S","7O","8Q","9K","9M2","9N","9V"],
  AF: ["3B","3C","3DA","5H","5N","5R","5T","5U","5V","5X","5Z","7Q","7X","9G","9J","9L","9Q","9U","9X","C5","C9","CN","D2","D4","D6","EA8","EA9","ET","J5","S0","S7","ST","SU","TR","TT","TY","TZ","V5","VQ9","XT","Z2","ZD7","ZD8","ZS"],
  OC: ["3D2","4W","5W","A3","C2","DU","FK","FO","H4","KH0","KH2","KH6","KH8","P2","T2","T3","VK","VK9","VP6","YJ","ZK3","ZL"],
};
const prefixEntries = Object.entries(continentPrefixes).flatMap(([continent, prefixes]) => prefixes.map(prefix => [prefix, continent as Continent] as const)).sort((a, b) => b[0].length - a[0].length);
export function callsignContinent(value: unknown): Continent | null {
  const parts = cleanCall(value).split("/").filter(Boolean);
  const matches = parts.flatMap(part => { const match = prefixEntries.find(([prefix]) => part.startsWith(prefix)); return match ? [{ continent: match[1], prefixLength: match[0].length, partLength: part.length }] : []; });
  matches.sort((a, b) => b.prefixLength - a.prefixLength || b.partLength - a.partLength);
  return matches[0]?.continent ?? null;
}

function dateValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value > 10_000_000_000 ? value : value * 1000;
  if (typeof value !== "string" || !value) return null;
  const iso = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const parsed = Date.parse(iso); return Number.isFinite(parsed) ? parsed : null;
}
export function parseWSPR(payload: unknown): PropagationSpot[] {
  const rows = (payload as { data?: unknown[] })?.data; if (!Array.isArray(rows)) return [];
  const byWspr = new Map<number, string>(propagationBands.filter(b => b.wspr !== null).map(b => [Number(b.wspr), b.key]));
  const groups = new Map<string, PropagationSpot>();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const [bucket, wsprBand, tx, rx, distance] = row, band = byWspr.get(Number(wsprBand)), time = dateValue(bucket);
    if (!band || time === null) continue;
    const txContinent = callsignContinent(tx), rxContinent = callsignContinent(rx);
    const key = `${time}|${band}|${txContinent || ""}|${rxContinent || ""}`;
    const existing = groups.get(key);
    if (existing) { existing.count = (existing.count || 1) + 1; continue; }
    groups.set(key, { time, tx: "", rx: "", band, mode: "WSPR", source: "wspr",
      txContinent, rxContinent, distance: Number(distance) || 0, count: 1 });
  }
  return [...groups.values()];
}
export function parseOwnWSPR(payload: unknown, ownCall: string): OwnWSPRSpot[] {
  const rows = (payload as { data?: unknown[] })?.data, call = cleanCall(ownCall); if (!Array.isArray(rows) || !call) return [];
  const byWspr = new Map<number, string>(propagationBands.filter(b => b.wspr !== null).map(b => [Number(b.wspr), b.key]));
  return rows.flatMap(row => {
    if (!Array.isArray(row)) return [];
    const [at, wsprBand, txValue, rxValue, snrValue] = row, band = byWspr.get(Number(wsprBand)), time = dateValue(at);
    if (!band || time === null) return [];
    const tx = cleanCall(txValue), rx = cleanCall(rxValue), snr = Number(snrValue) || 0, out: OwnWSPRSpot[] = [];
    if (tx === call) out.push({ time, band, kind: "tx", other: rx, continent: callsignContinent(rx), snr });
    if (rx === call) out.push({ time, band, kind: "rx", other: tx, continent: callsignContinent(tx), snr });
    return out;
  });
}
export function parsePSKReporter(xml: string): PropagationSpot[] {
  const out: PropagationSpot[] = [], reports = xml.matchAll(/<receptionReport\s+([^/]+)\/>/gi);
  for (const match of reports) {
    const attrs: Record<string, string> = {}; for (const item of match[1].matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) attrs[item[1]] = item[2];
    const band = bandFromFrequency(Number(attrs.frequency) / 1000), time = dateValue(Number(attrs.flowStartSeconds));
    if (!band || time === null) continue;
    const tx = cleanCall(attrs.senderCallsign), rx = cleanCall(attrs.receiverCallsign);
    out.push({ time, tx, rx, band, mode: normalizedMode(attrs.mode), source: "pskr", txContinent: callsignContinent(tx), rxContinent: callsignContinent(rx), distance: 0 });
  }
  return out;
}
export function parseDXHeat(payload: unknown): { cluster: PropagationSpot[]; rbn: PropagationSpot[] } {
  if (!Array.isArray(payload)) return { cluster: [], rbn: [] };
  const cluster: PropagationSpot[] = [], rbn: PropagationSpot[] = [];
  for (const row of payload as Record<string, unknown>[]) {
    const band = bandFromFrequency(Number(row.Frequency)), tx = cleanCall(row.DXCall), rx = cleanCall(row.Spotter);
    if (!band || !tx) continue;
    const parts = String(row.Date || "").split("/"), hm = String(row.Time || "00:00").split(":"), time = parts.length === 3
      ? Date.UTC(2000 + Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]), Number(hm[0]), Number(hm[1])) : Date.now();
    const spot: PropagationSpot = { time, tx, rx, band, mode: normalizedMode(row.Mode), source: "cluster",
      txContinent: continentValue(row.Continent_dx) || callsignContinent(tx), rxContinent: continentValue(row.Continent_spotter) || callsignContinent(rx), distance: 0 };
    cluster.push(spot); if (spot.mode === "CW" || spot.mode === "RTTY") rbn.push({ ...spot, source: "rbn" });
  }
  return { cluster, rbn };
}
function continentValue(value: unknown): Continent | null { const item = String(value || "").toUpperCase(); return continents.includes(item as Continent) ? item as Continent : null; }

export function mergeSpots(previous: PropagationSpot[], incoming: PropagationSpot[], now = Date.now()) {
  const cutoff = now - 3 * 60 * 60 * 1000, seen = new Set<string>(), merged: PropagationSpot[] = [];
  const replacesLegacyWSPR = incoming.some(spot => spot.source === "wspr" && typeof spot.count === "number");
  const retained = replacesLegacyWSPR ? previous.filter(spot => spot.source !== "wspr") : previous;
  for (const spot of [...incoming, ...retained].sort((a, b) => b.time - a.time)) {
    if (spot.time < cutoff) continue;
    const key = `${spot.source}|${spot.time}|${spot.band}|${spot.tx}|${spot.rx}|${spot.mode}|${spot.txContinent || ""}|${spot.rxContinent || ""}`;
    if (!seen.has(key)) { seen.add(key); merged.push(spot); }
    if (merged.length >= 20_000) break;
  }
  return merged;
}
export function matrixCounts(spots: PropagationSpot[], settings: PropagationSettings, now = Date.now()) {
  const end = Math.floor(now / 600_000) * 600_000, start = end - 600_000, modes = new Set(settings.matrixModes), bands = new Set(settings.bands);
  const counts = Object.fromEntries(settings.bands.map(band => [band, Object.fromEntries(continents.map(continent => [continent, 0]))])) as Record<string, Record<Continent, number>>;
  for (const spot of spots) if (spot.time >= start && spot.time < end && bands.has(spot.band) && modes.has(spot.mode)) {
    const weight = spot.count || 1;
    if (spot.txContinent) counts[spot.band][spot.txContinent] += weight;
    if (spot.rxContinent && spot.rxContinent !== spot.txContinent) counts[spot.band][spot.rxContinent] += weight;
  }
  return counts;
}
export function perMinuteSeries(spots: PropagationSpot[], settings: PropagationSettings, now = Date.now()) {
  const end = Math.floor((now - 5 * 60_000) / 60_000) * 60_000, modes = new Set(settings.chartModes), bands = new Set(settings.bands);
  const result = Object.fromEntries(settings.bands.map(band => [band, Array(60).fill(0)])) as Record<string, number[]>;
  for (const spot of spots) {
    if (!bands.has(spot.band) || !modes.has(spot.mode)) continue;
    const index = 59 - Math.floor((end - spot.time) / 60_000); if (index >= 0 && index < 60) result[spot.band][index] += spot.count || 1;
  }
  for (const values of Object.values(result)) for (let i = 59; i > 0; i--) values[i] += values[i - 1];
  return { end, values: result };
}
export function modeCounts(spots: PropagationSpot[], bands: string[], now = Date.now()) {
  const cutoff = now - 3_600_000, allowed = new Set(bands);
  const result = Object.fromEntries(bands.map(band => [band, Object.fromEntries(propagationModes.map(mode => [mode, 0]))])) as Record<string, Record<PropagationMode, number>>;
  for (const spot of spots) if (spot.time >= cutoff && allowed.has(spot.band)) result[spot.band][spot.mode] += spot.count || 1;
  return result;
}
export function ownGrid(spots: OwnWSPRSpot[], kind: "tx" | "rx", bands: string[], now = Date.now()) {
  const cutoff = now - 600_000, result: Record<string, Record<Continent, { count: number; average: number }>> = {};
  for (const band of bands) result[band] = Object.fromEntries(continents.map(c => [c, { count: 0, average: 0 }])) as Record<Continent, { count: number; average: number }>;
  const sums: Record<string, Record<string, number>> = {};
  for (const spot of spots) if (spot.kind === kind && spot.time >= cutoff && result[spot.band] && spot.continent) {
    const cell = result[spot.band][spot.continent]; cell.count++; sums[spot.band] ||= {}; sums[spot.band][spot.continent] = (sums[spot.band][spot.continent] || 0) + spot.snr;
  }
  for (const band of bands) for (const continent of continents) { const cell = result[band][continent]; if (cell.count) cell.average = Math.round((sums[band]?.[continent] || 0) / cell.count); }
  return result;
}

export function xrayClass(flux: number) {
  if (!Number.isFinite(flux) || flux <= 0) return "—";
  const bands = [{ c: "A", e: -8 }, { c: "B", e: -7 }, { c: "C", e: -6 }, { c: "M", e: -5 }, { c: "X", e: -4 }];
  let selected = bands[0]; for (const band of bands) if (Math.log10(flux) >= band.e) selected = band;
  return `${selected.c}${(flux / 10 ** selected.e).toFixed(1)}`;
}
export function parseForecastText(text: string) {
  const clean = text.replace(/\r/g, ""), section = (heading: string, next: string) => {
    const match = clean.match(new RegExp(`${heading}[^\\n]*\\n([\\s\\S]*?)(?=${next}|$)`, "i"));
    return match?.[1].replace(/\s+/g, " ").trim().slice(0, 320) || "Forecast unavailable.";
  };
  return { geomagnetic: section("GEOMAGNETIC ACTIVITY", "SOLAR RADIATION STORM"), radiation: section("SOLAR RADIATION STORM", "RADIO BLACKOUT"), blackout: section("RADIO BLACKOUT", "FORECASTER") };
}
export function hfOutlook(solar: SolarConditions) {
  const sfi = solar.sfi ?? 0, kp = solar.kp ?? 0, x = solar.xray[0] || "A";
  if (kp >= 6 || x === "X") return { tone: "danger", title: "HF paths disrupted", detail: "Strong geomagnetic or X-ray activity can suppress or destabilize paths." };
  if (kp >= 4 || x === "M") return { tone: "warn", title: "Variable HF conditions", detail: "Expect disturbed paths and possible absorption, especially at higher latitudes." };
  if (sfi >= 140 && kp <= 2) return { tone: "good", title: "Strong higher-band potential", detail: "Solar flux is supportive and geomagnetic conditions are quiet." };
  if (sfi >= 100 && kp <= 3) return { tone: "good", title: "Useful HF conditions", detail: "Mid and upper HF bands have reasonable support with manageable disturbance." };
  return { tone: "neutral", title: "Lower-band paths favored", detail: "Low solar flux limits upper-band openings; inspect live activity before choosing a band." };
}
