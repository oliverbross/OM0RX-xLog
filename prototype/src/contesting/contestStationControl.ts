import { invoke } from "@tauri-apps/api/core";

type NativeRequest = (command: string, args: Record<string, unknown>) => Promise<unknown>;

/** Let the native owner resolve and fence xLog's current selected radio. */
export async function setContestCWSpeed(value: number, request: NativeRequest = invoke) {
  if (!Number.isInteger(value) || value < 5 || value > 100) throw new Error("CW speed must be between 5 and 100 WPM.");
  return request("contest_cw_speed_request", { params: { words_per_minute: value } });
}
