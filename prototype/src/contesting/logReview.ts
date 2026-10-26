import { bandForRadio } from "../live/band";
/** Pure comparison, run only in the review window's worker; never in live logging. */
export type ReviewQSO = {
  ID: string; Call: string; TS: string; Freq: number; QSXFreq?: number;
  Mode: string; Band?: string | number; NR?: number | string;
  ContestName?: string; CountryPrefix?: string; ZN?: number | string;
};
export type ReviewCountry = {source:string;adif:number;cqZone:number;country:string;primaryPrefix?:string};
export type ReviewReference = {id:string;call:string;lotwListed:boolean|null;countries:ReviewCountry[]};
export type ReviewReferences = {sources:{name:string;status:string;version:string|null;modifiedAt?:string|null}[];rows:ReviewReference[]};
export type ReviewSpot = {
  id: string; callsign: string; spotter: string; frequencyKHz: number; band: string; mode: string;
  reportedAt: string | null; arrivedAt: string; recordKind: string; source: string;
  comment: string; clusterName: string; rawLine?: string;
};
export type ReviewOptions = { minutes: number; kHz: number; searchMinutes: number };
export const defaultReviewOptions: ReviewOptions = { minutes: 5, kHz: 2, searchMinutes: 60 };
export type ReviewFinding = {
  key: string; kind: "Possible typo" | "Frequency/time mismatch" | "Country / zone mismatch"; qso: ReviewQSO;
  explanation: string; evidence: ReviewSpot[]; evidenceCount: number;
  reference?:ReviewReference;
  candidateCalls?:string[];
};
export type ReviewResult = {
  findings: ReviewFinding[]; checked: number; corroborated: number; withoutEvidence: number;
  invalidContacts: number; excludedReports: number; eligibleReports: number; unsupportedBandContacts:number;
};
const call = (value: string) => value.trim().toUpperCase();
export const reviewMode = (value: string) => {
  const mode = value.trim().toUpperCase();
  return ["SSB", "USB", "LSB", "PH", "PHONE"].includes(mode) ? "SSB" : mode;
};
const band = (frequency: number) => bandForRadio(frequency * 1000) ?? "";
export function reviewTime(value: string): number {
  // Not1MM timestamps are UTC, even without a suffix. Reject malformed dates.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(" ", "T") + "Z" : value;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(iso)) return NaN;
  const time = Date.parse(iso);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,19) === iso.slice(0,19) ? time : NaN;
}
export const validReviewCall = (value: string) => /^[A-Z0-9/]{3,32}$/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
const validCall = validReviewCall;

/** One substitution, insertion, deletion or adjacent transposition. Slash parts must match. */
export function possibleCallTypo(first: string, second: string): boolean {
  const a = call(first), b = call(second);
  if (a === b || !validCall(a) || !validCall(b)) return false;
  const ap = a.split("/"), bp = b.split("/");
  if (ap.length !== bp.length) return false;
  if (ap.length > 1) {
    const changed = ap.map((part,index) => part !== bp[index] ? index : -1).filter(index => index >= 0);
    // Do not infer operating location or portable suffix corrections.
    if (changed.length !== 1 || !validCall(ap[changed[0]]) || !validCall(bp[changed[0]])) return false;
    return possibleCallTypo(ap[changed[0]], bp[changed[0]]);
  }
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    const different = [...a].map((char,index) => char !== b[index] ? index : -1).filter(index => index >= 0);
    return different.length === 1 || (different.length === 2 && different[1] === different[0]+1
      && a[different[0]] === b[different[1]] && a[different[1]] === b[different[0]]);
  }
  const [short,long] = a.length < b.length ? [a,b] : [b,a];
  let index = 0;
  while (index < short.length && short[index] === long[index]) index++;
  return short.slice(index) === long.slice(index+1);
}

export function compareContestLog(qsos: ReviewQSO[], spots: ReviewSpot[], options: ReviewOptions,
  references:ReviewReferences={sources:[],rows:[]}): ReviewResult {
  if (!Number.isFinite(options.minutes) || options.minutes < 1 || options.minutes > 30 ||
      !Number.isFinite(options.kHz) || options.kHz < 0.1 || options.kHz > 10 ||
      !Number.isFinite(options.searchMinutes) || options.searchMinutes < options.minutes || options.searchMinutes > 180)
    throw new Error("Choose 1–30 minutes, 0.1–10 kHz and a search window between the time tolerance and 180 minutes.");
  type Timed = { spot: ReviewSpot; time: number; call: string; frequency: number };
  const groups = new Map<string, Timed[]>(), exact = new Map<string, Timed[]>();
  let excludedReports = 0;
  for (const spot of spots) {
    const name = call(spot.callsign), time = reviewTime(spot.reportedAt ?? "");
    const frequency = Number(spot.frequencyKHz), mode = reviewMode(spot.mode), spotBand = band(frequency);
    if (!["live","historical_reply","import"].includes(spot.recordKind) || !Number.isFinite(time)
      || !validCall(name) || !spotBand || !mode || /heard while tuning|logged (?:qso|contact)/i.test(spot.comment)
      || /^(local|manual|log)$/i.test(spot.source)) { excludedReports++; continue; }
    const key = spotBand + "/" + mode, item = {spot,time,call:name,frequency};
    if (!groups.has(key)) groups.set(key,[]);
    groups.get(key)!.push(item);
    const exactKey = key + "/" + name;
    if (!exact.has(exactKey)) exact.set(exactKey,[]);
    exact.get(exactKey)!.push(item);
  }
  for (const group of groups.values()) group.sort((a,b) => a.time-b.time);
  const result: ReviewResult = {findings:[],checked:0,corroborated:0,withoutEvidence:0,
    invalidContacts:0,unsupportedBandContacts:0,excludedReports,eligibleReports:spots.length-excludedReports};
  const referenceByID=new Map(references.rows.map(row=>[row.id,row]));
  const tolerance = options.minutes*60000, horizon = options.searchMinutes*60000;
  for (const qso of qsos) {
    const name = call(qso.Call), time = reviewTime(qso.TS), frequency = Number(qso.Freq);
    const qsoBand = band(frequency), mode = reviewMode(qso.Mode);
    if (!qso.ID || !validCall(name) || !Number.isFinite(time) || !Number.isFinite(frequency) || frequency<=0 || !mode) { result.invalidContacts++; continue; }
    if (!qsoBand) { result.unsupportedBandContacts++; continue; }
    result.checked++;
    const reference=referenceByID.get(qso.ID);
    if(reference && call(reference.call)===name) {
      const issues:string[]=[];
      const cty=reference.countries.find(country=>country.source==="cty");
      const prefix=call(qso.CountryPrefix??"");
      if(cty?.primaryPrefix && prefix!==call(cty.primaryPrefix))
        issues.push(`Logged country ${prefix||"missing"}; bundled CTY resolves ${cty.primaryPrefix} (${cty.country}).`);
      // NR is the received CQ zone only in CQ WW CW/SSB, not a general serial field.
      if(/^CQ-WW-(SSB|CW)$/i.test(qso.ContestName??"")) {
        const zone=Number(qso.NR);
        if(!Number.isInteger(zone)||zone<1||zone>40) issues.push(`Received CQ zone ${qso.NR??"missing"} is outside 1–40.`);
        else for(const country of reference.countries) if(country.cqZone>=1 && country.cqZone<=40 && country.cqZone!==zone)
          issues.push(`Received CQ zone ${zone}; ${country.source} suggests ${country.cqZone} (${country.country}).`);
      }
      const club=reference.countries.find(country=>country.source==="clublog");
      if(cty && club && cty.adif>0 && club.adif>0 && cty.adif!==club.adif)
        issues.push(`Country references disagree: CTY DXCC ${cty.adif}, Club Log DXCC ${club.adif}.`);
      if(issues.length) result.findings.push({kind:"Country / zone mismatch",qso,reference,evidence:[],evidenceCount:0,
        key:JSON.stringify([qso,"reference",reference,references.sources]),
        explanation:issues.join(" ")+" These are reference suggestions, not proof. Received exchanges, portable operation and dated exceptions may legitimately differ; verify before correcting."});
    }
    const key = qsoBand + "/" + mode;
    // DXLOG Freq/QSXFreq are kHz. A spot matching either side of a split is valid evidence.
    const frequencies = [frequency, Number(qso.QSXFreq)].filter(value => value > 0 && band(value) === qsoBand);
    const frequencyMatches = (item: Timed) => frequencies.some(value => Math.abs(item.frequency-value) <= options.kHz);
    const sameCall = (exact.get(key + "/" + name) ?? []).filter(item => Math.abs(item.time-time) <= horizon);
    if (sameCall.some(item => Math.abs(item.time-time) <= tolerance && frequencyMatches(item))) {
      result.corroborated++; continue;
    }
    const candidates: Timed[] = [];
    const group = groups.get(key) ?? [];
    let lo = 0, hi = group.length;
    while (lo < hi) { const mid = (lo+hi)>>>1; if (group[mid].time < time-tolerance) lo=mid+1; else hi=mid; }
    for (let index = lo; index < group.length && group[index].time <= time+tolerance; index++) {
      const item = group[index];
      if (frequencyMatches(item) && possibleCallTypo(name,item.call)) candidates.push(item);
    }
    const add = (kind: ReviewFinding["kind"], evidence: Timed[], explanation: string) => {
      // Repeated/rebroadcast reports are evidence, not independent votes of confidence.
      const unique = new Map<string, Timed>();
      for (const item of [...evidence].sort((a,b) => Math.abs(a.time-time)-Math.abs(b.time-time) || a.spot.id.localeCompare(b.spot.id))) {
        const fingerprint = [item.call,item.frequency,item.time,call(item.spot.spotter)].join("|");
        if (!unique.has(fingerprint)) unique.set(fingerprint,item);
      }
      const retained = [...unique.values()].slice(0,8).map(item=>item.spot);
      const fingerprint = JSON.stringify([qso.ID,name,qso.TS,frequency,qso.QSXFreq,mode,qso.NR,qso.CountryPrefix,kind,options,
        retained.map(spot=>[spot.callsign,spot.frequencyKHz,spot.reportedAt,spot.spotter])]);
      result.findings.push({key:fingerprint,kind,qso,explanation,evidence:retained,evidenceCount:unique.size,reference,
        candidateCalls:kind==="Possible typo"?[...new Set(evidence.map(item=>item.call))].sort():undefined});
    };
    if (candidates.length) add("Possible typo",candidates,
      "A similar callsign was reported nearby in time and frequency. This can also be another station on a busy frequency; verify your notes or recording.");
    // Only flag a mismatch when there is a nearby time OR nearby frequency anchor.
    const mismatches = sameCall.filter(item => Math.abs(item.time-time) <= tolerance || frequencyMatches(item));
    if (mismatches.length) add("Frequency/time mismatch",mismatches,
      "This exact callsign was reported outside your time or frequency tolerance. QSY, split operation, delayed spots and clock differences can explain this.");
    if (!candidates.length && !mismatches.length) result.withoutEvidence++;
  }
  return result;
}
