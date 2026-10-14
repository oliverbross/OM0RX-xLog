import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const detachedClusterMethods = [
  "cluster_snapshot", "cluster_filter", "cluster_connect", "cluster_disconnect",
  "cluster_history", "cluster_command", "cluster_console_clear", "cluster_configure",
] as const;
export type DetachedClusterMethod = typeof detachedClusterMethods[number];
export type ClusterRequestEnvelope = { id: string; method: DetachedClusterMethod; params: Record<string, unknown> };
export type ClusterResponseEnvelope = { id: string; ok: boolean; result?: Record<string, unknown>; error?: { message?: string } };
export type ClusterProjection = { revision: number; response: Record<string, unknown> | null; selected: string | null; available: boolean; received_at_ms?: number };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function validClusterRequest(value: unknown): value is ClusterRequestEnvelope {
  if (!record(value) || Object.keys(value).length !== 3 || typeof value.id !== "string" || !/^[\w-]{8,64}$/.test(value.id) ||
    !detachedClusterMethods.includes(value.method as DetachedClusterMethod) || !record(value.params)) return false;
  try { return new TextEncoder().encode(JSON.stringify(value)).length <= 32_768; } catch { return false; }
}

export function validClusterResponse(value: unknown): value is ClusterResponseEnvelope {
  return record(value) && typeof value.id === "string" && /^[\w-]{8,64}$/.test(value.id) &&
    typeof value.ok === "boolean" && (value.ok ? record(value.result) : record(value.error) && typeof value.error.message === "string");
}

export function validClusterProjection(value: unknown): value is ClusterProjection {
  if (!record(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 ||
    typeof value.available !== "boolean" ||
    value.received_at_ms !== undefined && (!Number.isSafeInteger(value.received_at_ms) || Number(value.received_at_ms) < 0) ||
    (value.selected !== null && typeof value.selected !== "string")) return false;
  if (value.response === null) return !value.available;
  if (!record(value.response) || !record(value.response.snapshot)) return false;
  const snapshot = value.response.snapshot as Record<string, unknown>;
  return Array.isArray(snapshot.spots) && snapshot.spots.length <= 500;
}

export function newerClusterProjection(current: ClusterProjection | null, incoming: ClusterProjection): ClusterProjection {
  return !current || incoming.revision > current.revision ? incoming : current;
}

export async function openDetachedCluster(): Promise<void> {
  await invoke("open_detached_map", { kind: "dx-cluster" });
}

export async function dockDetachedWorkspace(): Promise<void> {
  await invoke("dock_detached_window");
}

export async function announceDetachedClusterReady(): Promise<void> {
  await invoke("detached_cluster_ready");
}

export async function publishClusterSelection(selected: string | null): Promise<void> {
  if (isTauri()) await invoke("cluster_session_selection", { selected });
}

export async function onClusterProjection(handler: (projection: ClusterProjection) => void): Promise<UnlistenFn> {
  return listen("xlog:cluster-projection", event => {
    if (validClusterProjection(event.payload)) handler(event.payload);
  });
}

export async function onDetachedDock(handler: (kind: string) => void): Promise<UnlistenFn> {
  return listen("xlog:detached-dock", event => {
    if (["dx-cluster", "world-map", "band-maps"].includes(String(event.payload))) handler(String(event.payload));
  });
}

export async function requestViaSession(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const request = { id: crypto.randomUUID(), method, params };
  if (!validClusterRequest(request)) throw new Error("This action is unavailable in the detached cluster. Use Settings for credentials and station controls.");
  const response = await invoke<unknown>("worker_request", { request });
  if (!validClusterResponse(response) || response.id !== request.id)
    throw new Error("The cluster response could not be verified. Refresh its state before trying another action.");
  if (!response.ok) throw new Error(response.error?.message || "Cluster action failed. Refresh its state before trying again.");
  return response.result;
}
