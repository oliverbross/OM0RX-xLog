import { invoke } from "@tauri-apps/api/core";
export type StationReceipt = { operation_id: string; status: "pending" | "unknown" | "saved" | "acknowledged" | "confirmed"; request: { action: string } };
export type StationSession = {
  generation: string; revision: number; base_url: string; last_receipt: StationReceipt | null;
  hamlib?: HamlibConfiguration | null;
  flex?: FlexConfiguration | null;
  selection: { provider: string | null; generation: number; selection_id: string | null; control_revision?: number };
  worker_generation?: number;
  radio?: { provider: string; selection_id: string; selection_generation: number; snapshot: Record<string, any> };
};
export type HamlibConfiguration = { mode: "managed" | "external"; model?: number; path?: string; baud?: number; host?: string; port?: number; serial?: Record<string, string | number> };
export type FlexConfiguration = { host: string; port: number; station_name: string };
export async function stationSessionRequest<T>(params: Record<string, unknown>): Promise<T> {
  return invoke<T>("station_session_request", { params });
}
export const loadStationSession = () => stationSessionRequest<StationSession>({ action: "snapshot" });
