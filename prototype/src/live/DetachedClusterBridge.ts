import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";

export const detachedClusterMethods = [
  "cluster_snapshot", "cluster_filter", "cluster_connect", "cluster_disconnect",
  "cluster_history", "cluster_command", "cluster_console_clear", "cluster_configure",
] as const;
export type DetachedClusterMethod = typeof detachedClusterMethods[number];
export type ClusterRequestEnvelope = { id: string; method: DetachedClusterMethod; params: Record<string, unknown> };
export type ClusterResponseEnvelope = { id: string; ok: boolean; result?: unknown; error?: string };
export type ClusterProjection = { revision: number; response: Record<string, unknown>; selected: string | null };

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function validClusterRequest(value: unknown): value is ClusterRequestEnvelope {
  if (!record(value) || Object.keys(value).length !== 3 || typeof value.id !== "string" || !/^[\w-]{8,64}$/.test(value.id) ||
    !detachedClusterMethods.includes(value.method as DetachedClusterMethod) || !record(value.params)) return false;
  try { return new TextEncoder().encode(JSON.stringify(value)).length <= 32_768; } catch { return false; }
}

export function validClusterResponse(value: unknown): value is ClusterResponseEnvelope {
  return record(value) && typeof value.id === "string" && /^[\w-]{8,64}$/.test(value.id) &&
    typeof value.ok === "boolean" && (value.ok ? record(value.result) : typeof value.error === "string");
}

export function validClusterProjection(value: unknown): value is ClusterProjection {
  if (!record(value) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 ||
    !record(value.response) || !record(value.response.snapshot) ||
    (value.selected !== null && typeof value.selected !== "string")) return false;
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

export async function publishClusterProjection(projection: ClusterProjection): Promise<void> {
  if (validClusterProjection(projection)) await emitTo("dx-cluster", "xlog:cluster-projection", projection);
}

export async function onClusterProjection(handler: (projection: ClusterProjection) => void): Promise<UnlistenFn> {
  return listen("xlog:cluster-projection", event => {
    if (validClusterProjection(event.payload)) handler(event.payload);
  });
}

export async function onClusterReady(handler: () => void): Promise<UnlistenFn> {
  return listen("xlog:cluster-ready", () => handler());
}

export async function onDetachedDock(handler: (kind: string) => void): Promise<UnlistenFn> {
  return listen("xlog:detached-dock", event => {
    if (["dx-cluster", "world-map", "band-maps"].includes(String(event.payload))) handler(String(event.payload));
  });
}

export async function onClusterRequest(handler: (request: ClusterRequestEnvelope) => void): Promise<UnlistenFn> {
  return listen("xlog:cluster-request", event => {
    if (typeof event.payload !== "string" || !/^[\w-]{8,64}$/.test(event.payload)) return;
    // The event contains only a ticket. Rust injects the sender window label,
    // stores the canonical validated request, and permits a single main-only claim.
    void invoke<unknown>("claim_detached_cluster_request", { id: event.payload }).then(request => {
      if (validClusterRequest(request)) handler(request);
    }).catch(() => {});
  });
}

export async function completeClusterRequest(response: ClusterResponseEnvelope): Promise<void> {
  if (validClusterResponse(response)) await invoke("complete_detached_cluster_request", { response });
}

export async function requestViaMain(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const envelope = { id: crypto.randomUUID(), method, params };
  if (!validClusterRequest(envelope)) throw new Error("This cluster action is unavailable in the detached window. Open DX Cluster in the main workspace.");
  return new Promise((resolve, reject) => {
    let unlisten: UnlistenFn | null = null;
    let finished = false;
    const finish = (value: ClusterResponseEnvelope | Error) => {
      if (finished) return;
      finished = true; window.clearTimeout(timer); unlisten?.();
      if (value instanceof Error) reject(value);
      else if (value.ok) resolve(value.result);
      else reject(new Error(value.error || "Cluster action failed in the main workspace."));
    };
    const timer = window.setTimeout(() => finish(new Error("Main workspace did not confirm the cluster action. Check its connection and retry.")), 50_000);
    void listen("xlog:cluster-response", event => {
      if (validClusterResponse(event.payload) && event.payload.id === envelope.id) finish(event.payload);
    }).then(stop => {
      if (finished) { stop(); return; }
      unlisten = stop;
      void invoke("detached_cluster_request", { request: envelope }).catch(() => finish(new Error("Could not reach the main cluster workspace.")));
    }).catch(() => finish(new Error("Could not listen for the main workspace response.")));
  });
}
