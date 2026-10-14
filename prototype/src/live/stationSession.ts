import { invoke } from "@tauri-apps/api/core";
export type StationReceipt = { operation_id: string; status: "pending" | "unknown" | "saved" | "acknowledged"; request: { action: string } };
export type StationSession = {
  generation: string; revision: number; base_url: string; last_receipt: StationReceipt | null;
  hamlib?: HamlibConfiguration | null;
  selection: { provider: string | null; generation: number; selection_id: string | null };
};
export type HamlibConfiguration = { mode: "managed" | "external"; model?: number; path?: string; baud?: number; host?: string; port?: number; serial?: Record<string, string | number> };
export async function stationSessionRequest<T>(params: Record<string, unknown>): Promise<T> {
  return invoke<T>("station_session_request", { params });
}
export const loadStationSession = () => stationSessionRequest<StationSession>({ action: "snapshot" });
