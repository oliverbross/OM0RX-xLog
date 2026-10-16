import { invoke } from "@tauri-apps/api/core";
export type StationReceipt = { operation_id: string; status: "pending" | "unknown" | "saved" | "acknowledged" | "confirmed" | "reviewed"; request: { action: string } };
export type StationSession = {
  generation: string; revision: number; base_url: string; last_receipt: StationReceipt | null; manual_tune_receipt?: StationReceipt | null;
  tci_filter_receipt?: StationReceipt | null;
  hamlib?: HamlibConfiguration | null;
  flex?: FlexConfiguration | null;
  tci?: TCIConfiguration | null;
  selection: { provider: string | null; generation: number; selection_id: string | null; control_revision?: number };
  worker_generation?: number;
  radio?: { provider: string; selection_id: string; selection_generation: number; snapshot: Record<string, any> };
};
export type HamlibConfiguration = { mode: "managed" | "external"; model?: number; path?: string; baud?: number; host?: string; port?: number; serial?: Record<string, string | number> };
export type FlexConfiguration = { host: string; port: number; station_name: string };
export type TCIConfiguration = { endpoint: string; trx: number; channel: number };
export function validTCIConfiguration(configuration: TCIConfiguration): boolean {
  try {
    const endpoint = new URL(configuration.endpoint.trim());
    return new TextEncoder().encode(configuration.endpoint.trim()).length <= 2_048 && new TextEncoder().encode(endpoint.href).length <= 2_048 && ["ws:", "wss:"].includes(endpoint.protocol) && !!endpoint.hostname && endpoint.port !== "0" && !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash &&
      [configuration.trx, configuration.channel].every(value => Number.isInteger(value) && value >= 0 && value <= 15);
  } catch { return false; }
}
export async function stationSessionRequest<T>(params: Record<string, unknown>): Promise<T> {
  return invoke<T>("station_session_request", { params });
}
export const loadStationSession = () => stationSessionRequest<StationSession>({ action: "snapshot" });
