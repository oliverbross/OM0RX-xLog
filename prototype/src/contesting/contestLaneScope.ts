import type { ContestLaneBinding } from "./contestStationControl";

export type ContestLaneID = "laneA" | "laneB";
export type ContestLaneSnapshot = { laneID: ContestLaneID; draftID: string; bindingVersion: number;
  binding: ContestLaneBinding | null; fields: { id: string; value: string; readOnly?: boolean }[];
  frequencyHz: number; mode: string; run: boolean; focus: string; reservedSerial?: number | null;
  receiveFrequencyHz?: number | null; cqContext?: Record<string, unknown>; [key: string]: unknown };
export type ContestLaneProjectionSource = { sessionID: string; workspaceGeneration: string; draftID: string; revision: number;
  operatingLanes?: { version: number; mode: "SO1V" | "SO2V" | "SO2R"; keyboardLaneID: ContestLaneID; lanes: ContestLaneSnapshot[] };
  selectedLaneID?: ContestLaneID; bindingVersion?: number };
export type CapturedContestLaneScope = { sessionID: string; workspaceGeneration: string; laneID: ContestLaneID;
  draftID: string; bindingVersion: number; bindingGeneration: string | number | null };

export const dualContestLanes = (source: ContestLaneProjectionSource | null | undefined) => Boolean(source?.operatingLanes && source.operatingLanes.mode !== "SO1V");
export function contestLaneSnapshot(source: ContestLaneProjectionSource, laneID = source.operatingLanes?.keyboardLaneID ?? "laneA") {
  const lane = source.operatingLanes?.lanes.find(item => item.laneID === laneID);
  if (!lane) throw Error("The requested operating lane is unavailable. Refresh the contest session.");
  return lane;
}
export function captureContestLaneScope(source: ContestLaneProjectionSource, laneID?: ContestLaneID): CapturedContestLaneScope {
  const lane = contestLaneSnapshot(source, laneID);
  return { sessionID: source.sessionID, workspaceGeneration: source.workspaceGeneration, laneID: lane.laneID,
    draftID: lane.draftID, bindingVersion: lane.bindingVersion, bindingGeneration: lane.binding?.generation ?? null };
}
export function assertContestLaneScope(source: ContestLaneProjectionSource, captured: CapturedContestLaneScope) {
  const current = captureContestLaneScope(source, captured.laneID);
  if (Object.keys(current).some(key => current[key as keyof typeof current] !== captured[key as keyof typeof captured]))
    throw Error("The operating lane, draft or receiver binding changed. Review this lane before trying again.");
  return contestLaneSnapshot(source, captured.laneID);
}
export function contestLaneParams(scope: CapturedContestLaneScope) {
  return { laneID: scope.laneID, draftID: scope.draftID, bindingVersion: scope.bindingVersion,
    workspaceGeneration: scope.workspaceGeneration };
}
export function contestLaneProjection<T extends ContestLaneProjectionSource>(source: T, laneID?: ContestLaneID): T {
  if (!dualContestLanes(source)) return source;
  const lane = contestLaneSnapshot(source, laneID);
  return { ...source, ...lane, selectedLaneID: lane.laneID } as T;
}

export type ContestLaneBuffer = { scope: CapturedContestLaneScope; baseline: Record<string, string>;
  fields: Record<string, string>; frequencyHz: number; frequencyText: string; receiveFrequencyHz: number | null;
  receiveFrequencyText: string; version: number; heardFieldIDs: string[]; conflicts: string[] };
/** Merge only the corresponding lane. Locally typed values survive unrelated
 * receipts; concurrent authoritative edits stay explicit until reviewed.
 */
export function mergeContestLaneBuffer(previous: ContestLaneBuffer | undefined, source: ContestLaneProjectionSource, laneID: ContestLaneID): ContestLaneBuffer {
  const lane = contestLaneSnapshot(source, laneID), scope = captureContestLaneScope(source, laneID);
  const baseline = Object.fromEntries(lane.fields.map(field => [field.id, field.value]));
  const same = previous && Object.keys(scope).every(key => scope[key as keyof typeof scope] === previous.scope[key as keyof typeof scope]);
  if (!same || !previous) return { scope, baseline, fields: { ...baseline }, frequencyHz: lane.frequencyHz,
    frequencyText: String(lane.frequencyHz), receiveFrequencyHz: lane.receiveFrequencyHz ?? null,
    receiveFrequencyText: lane.receiveFrequencyHz == null ? "" : String(lane.receiveFrequencyHz), version: 0, heardFieldIDs: [], conflicts: [] };
  const fields = { ...baseline }, conflicts: string[] = previous.conflicts.filter(key =>
    key === "frequencyHz" ? previous.frequencyText !== String(lane.frequencyHz) :
      key === "receiveFrequencyHz" ? previous.receiveFrequencyText !== (lane.receiveFrequencyHz == null ? "" : String(lane.receiveFrequencyHz)) :
        previous.fields[key] !== baseline[key]);
  for (const field of lane.fields) {
    if (field.readOnly || previous.fields[field.id] === previous.baseline[field.id]) continue;
    fields[field.id] = previous.fields[field.id];
    if (field.value !== previous.baseline[field.id] && field.value !== previous.fields[field.id]) conflicts.push(field.id);
  }
  const frequencyDirty = previous.frequencyText !== String(previous.frequencyHz);
  if (frequencyDirty && lane.frequencyHz !== previous.frequencyHz && String(lane.frequencyHz) !== previous.frequencyText) conflicts.push("frequencyHz");
  const receiveText = lane.receiveFrequencyHz == null ? "" : String(lane.receiveFrequencyHz);
  const receiveDirty = previous.receiveFrequencyText !== (previous.receiveFrequencyHz == null ? "" : String(previous.receiveFrequencyHz));
  if (receiveDirty && (lane.receiveFrequencyHz ?? null) !== previous.receiveFrequencyHz && receiveText !== previous.receiveFrequencyText) conflicts.push("receiveFrequencyHz");
  return { ...previous, scope, baseline, fields, frequencyHz: lane.frequencyHz,
    frequencyText: frequencyDirty ? previous.frequencyText : String(lane.frequencyHz), receiveFrequencyHz: lane.receiveFrequencyHz ?? null,
    receiveFrequencyText: receiveDirty ? previous.receiveFrequencyText : receiveText, conflicts: [...new Set(conflicts)] };
}
