import { workerRequest } from "../worker";

export type OperatingGoal =
  | { type: "callsign"; callsign: string }
  | { type: "entity_slot"; dxcc: number; band: string; mode: string }
  | { type: "reference"; programme: "IOTA" | "POTA" | "SOTA" | "WWFF"; reference: string };

export type OperatingGoalEvidence = {
  id: string; source: string; source_url: string; callsign: string; reference: string;
  band: string; mode: string; observed_at: number; time_basis: string; expires_at: number;
  starts_at: number | null; age_seconds: number; freshness: "active" | "scheduled"; reason: string;
};
export type OperatingGoalEvaluation = {
  goal: OperatingGoal & { id: string }; worked: boolean; worked_count: number;
  confirmed: boolean; confirmed_count: number; evidence_eligible: boolean | null;
  credited: boolean | null; reasons: string[]; evidence: OperatingGoalEvidence[];
};
export type OperatingGoalResult = {
  evaluated_at: number;
  station_scope: { profile_id: number | null; callsign: string | null; all_stations: boolean };
  sources: {
    contacts: { state: "retained"; count: number };
    opportunities: { state: "retained"; count: number };
    cluster_observations: { state: "not_included"; count: 0 };
  };
  evaluations: OperatingGoalEvaluation[];
  read_only: true; tunes: false; transmits: false;
};

type Request = (method: string, params: Record<string, unknown>) => Promise<{ result?: unknown }>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length
  && Object.keys(value).every(key => keys.includes(key));
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const timestamp = (value: unknown): value is number => finite(value) && Math.abs(value) < 32_503_680_000;
const text = (value: unknown, maximum = 1024): value is string => typeof value === "string" && value.length <= maximum;

function readGoal(value: unknown): (OperatingGoal & { id: string }) | null {
  if (!object(value) || !text(value.id, 160) || typeof value.type !== "string") return null;
  if (value.type === "callsign" && exact(value, ["id", "type", "callsign"]) && text(value.callsign, 32)) return value as OperatingGoal & { id: string };
  if (value.type === "entity_slot" && exact(value, ["id", "type", "dxcc", "band", "mode"])
    && Number.isSafeInteger(value.dxcc) && (value.dxcc as number) >= 1 && (value.dxcc as number) <= 999
    && text(value.band, 16) && text(value.mode, 24)) return value as OperatingGoal & { id: string };
  if (value.type === "reference" && exact(value, ["id", "type", "programme", "reference"])
    && ["IOTA", "POTA", "SOTA", "WWFF"].includes(value.programme as string)
    && text(value.reference, 64)) return value as OperatingGoal & { id: string };
  return null;
}

function readEvidence(value: unknown): OperatingGoalEvidence | null {
  const keys = ["id", "source", "source_url", "callsign", "reference", "band", "mode", "observed_at",
    "time_basis", "expires_at", "starts_at", "age_seconds", "freshness", "reason"];
  if (!object(value) || !exact(value, keys)
    || !text(value.id) || !text(value.source) || !text(value.source_url, 2048) || !text(value.callsign, 32)
    || !text(value.reference, 64) || !text(value.band, 16) || !text(value.mode, 24) || !text(value.time_basis, 64)
    || !text(value.reason, 512) || !timestamp(value.observed_at) || !timestamp(value.expires_at)
    || value.starts_at !== null && !timestamp(value.starts_at) || !finite(value.age_seconds) || value.age_seconds < 0
    || !["active", "scheduled"].includes(value.freshness as string)) return null;
  return value as OperatingGoalEvidence;
}

export function readOperatingGoalResult(value: unknown): OperatingGoalResult {
  const fail = () => { throw new Error("The retained operating-goal evaluation could not be verified."); };
  if (!object(value) || !exact(value, ["evaluated_at", "station_scope", "sources", "evaluations", "read_only", "tunes", "transmits"])
    || !timestamp(value.evaluated_at) || value.read_only !== true || value.tunes !== false || value.transmits !== false
    || !object(value.station_scope) || !exact(value.station_scope, ["profile_id", "callsign", "all_stations"])
    || value.station_scope.profile_id !== null && !(Number.isSafeInteger(value.station_scope.profile_id) && (value.station_scope.profile_id as number) > 0)
    || value.station_scope.callsign !== null && !text(value.station_scope.callsign, 32)
    || typeof value.station_scope.all_stations !== "boolean" || value.station_scope.all_stations !== (value.station_scope.profile_id === null && value.station_scope.callsign === null)
    || !object(value.sources) || !exact(value.sources, ["contacts", "opportunities", "cluster_observations"])) return fail();
  const source = (item: unknown, state: string, zero = false) => object(item) && exact(item, ["state", "count"])
    && item.state === state && count(item.count) && (!zero || item.count === 0);
  if (!source(value.sources.contacts, "retained") || !source(value.sources.opportunities, "retained")
    || !source(value.sources.cluster_observations, "not_included", true)
    || !Array.isArray(value.evaluations) || value.evaluations.length > 128) return fail();
  const evaluations: OperatingGoalEvaluation[] = [];
  for (const item of value.evaluations) {
    if (!object(item) || !exact(item, ["goal", "worked", "worked_count", "confirmed", "confirmed_count", "evidence_eligible", "credited", "reasons", "evidence"])) return fail();
    const goal = readGoal(item.goal);
    if (!goal || typeof item.worked !== "boolean" || !count(item.worked_count) || item.worked !== (item.worked_count > 0)
      || typeof item.confirmed !== "boolean" || !count(item.confirmed_count) || item.confirmed !== (item.confirmed_count > 0)
      || item.confirmed_count > item.worked_count
      || item.evidence_eligible !== null && typeof item.evidence_eligible !== "boolean"
      || item.credited !== null && typeof item.credited !== "boolean"
      || !Array.isArray(item.reasons) || item.reasons.length > 16 || !item.reasons.every(reason => text(reason, 512))
      || !Array.isArray(item.evidence) || item.evidence.length > 4096) return fail();
    const evidence = item.evidence.map(readEvidence);
    if (evidence.some(entry => entry === null)) return fail();
    evaluations.push({ ...item, goal, evidence: evidence as OperatingGoalEvidence[] } as OperatingGoalEvaluation);
  }
  if (new Set(evaluations.map(item => item.goal.id)).size !== evaluations.length) return fail();
  return { ...value, evaluations } as OperatingGoalResult;
}

export async function evaluateOperatingGoals(goals: OperatingGoal[], scope: { profileID?: number; stationCall?: string } = {},
  request: Request = (method, params) => workerRequest(method, params), now: () => number = () => Date.now() / 1000) {
  const params: Record<string, unknown> = { goals, now: now() };
  if (scope.profileID !== undefined) params.station_profile_id = scope.profileID;
  if (scope.stationCall !== undefined) params.station_call = scope.stationCall;
  const response = await request("operating_goals_evaluate", params);
  return readOperatingGoalResult(response.result);
}
