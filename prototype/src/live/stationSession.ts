import { invoke } from "@tauri-apps/api/core";
export type StationReceipt = { operation_id: string; status: "pending" | "unknown" | "saved" | "acknowledged"; request: { action: string } };
export type StationSession = {
  generation: string; revision: number; base_url: string; last_receipt: StationReceipt | null;
  selection: { provider: string | null; generation: number; selection_id: string | null };
};
export async function stationSessionRequest<T>(params: Record<string, unknown>): Promise<T> {
  return invoke<T>("station_session_request", { params });
}
export const loadStationSession = () => stationSessionRequest<StationSession>({ action: "snapshot" });
