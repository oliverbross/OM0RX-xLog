import { invoke } from "@tauri-apps/api/core";

type NativeRequest = (command: string, args: Record<string, unknown>) => Promise<unknown>;
export type ContestLaneBinding = { radioID: "radio1" | "radio2"; receiverID: string; vfo: string; sliceID: string | null; generation: number | string };
export type ContestLaneOutputContext = { sessionID: string; workspaceGeneration: string; laneID: "laneA" | "laneB";
  draftID: string; bindingVersion: number; binding: ContestLaneBinding | null; operatingContext: string; workerGeneration?: number };
export type ContestLaneOutputAction = "capabilities" | "bind" | "tune" | "transverter_tune" | "listen" | "requestTX" | "send" | "macro" | "stop";
export type ContestTransverterMapping={band:string;loHz:number;inverted:boolean;ifLowHz:number;ifHighHz:number};

/** Explicit lane route only. Native admission decides whether an exact provider exists. */
export async function requestContestLaneOutput(context: ContestLaneOutputContext, action: ContestLaneOutputAction,
  values: { frequencyHz?: number; rfFrequencyHz?:number;mapping?:ContestTransverterMapping;mode?: string; text?: string; operationID?: string; revision?: number; stopOutcome?: "confirmed" | "uncertain" } = {}, request: NativeRequest = invoke) {
  if (!["laneA", "laneB"].includes(context.laneID) || !Number.isSafeInteger(context.bindingVersion) || context.bindingVersion < 0) throw Error("Invalid contest lane context.");
  if (!context.operatingContext) throw Error("Native operating context is required for lane actions.");
  if (action !== "stop" && action !== "capabilities" && !context.binding) throw Error("Bind this lane to an exact radio receiver and VFO first.");
  if (action !== "stop" && action !== "capabilities" && (!Number.isSafeInteger(context.workerGeneration) || (context.workerGeneration ?? 0) < 1)) throw Error("Refresh native lane capabilities before an explicit action.");
  if (action === "stop") return request("contest_lane_output_request", { params: { action, sessionID: context.sessionID,
    workspaceGeneration: context.workspaceGeneration, laneID: context.laneID, operatingContext: context.operatingContext, ...(values.stopOutcome ? { stopOutcome: values.stopOutcome } : {}) } });
  return request("contest_lane_output_request", { params: { ...context, action, ...values } });
}

/** Let the native owner resolve and fence xLog's current selected radio. */
export async function setContestCWSpeed(value: number, request: NativeRequest = invoke) {
  if (!Number.isInteger(value) || value < 5 || value > 100) throw new Error("CW speed must be between 5 and 100 WPM.");
  return request("contest_cw_speed_request", { params: { words_per_minute: value } });
}
