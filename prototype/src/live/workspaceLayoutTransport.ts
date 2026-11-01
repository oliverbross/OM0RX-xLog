import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LayoutRequestRejected } from "./workspaceLayoutSession";

/** Ephemeral native ordering only; never persisted or used as mutation authority. */
export function beginWorkspacePresentation(kind: "mode" | "layout"): Promise<number> | undefined {
  if (!isTauri()) return undefined;
  return invoke<unknown>("workspace_presentation_begin", { kind }).then(ticket => {
    if (!Number.isSafeInteger(ticket) || (ticket as number) <= 0) throw new Error("The native presentation ticket could not be verified.");
    return ticket as number;
  });
}

export async function requestWorkspaceLayout(method: "workspace_layout_load" | "workspace_layout_apply", params: Record<string, unknown> = {}): Promise<any> {
  if (!["workspace_layout_load", "workspace_layout_apply"].includes(method)) throw new Error("This operation is outside the workspace layout service.");
  const { presentationTicket, ...workerParams } = params;
  if (presentationTicket !== undefined && (method !== "workspace_layout_apply" || !Number.isSafeInteger(presentationTicket) || (presentationTicket as number) <= 0))
    throw new Error("The native layout presentation ticket could not be verified.");
  const request = { id: crypto.randomUUID(), method, params: workerParams,
    ...(presentationTicket === undefined ? {} : { presentationTicket }) };
  let response;
  try { response = await invoke<any>("worker_request", { request }); }
  catch (cause) {
    // Native command failures cross the Tauri bridge as strings on macOS.
    // Preserve the reason so a later refresh can clear the same session error.
    throw cause instanceof Error ? cause : new Error(typeof cause === "string" && cause.trim()
      ? cause : "The shared layout transport is unavailable. Reload before retrying.");
  }
  if (!response || response.id !== request.id || typeof response.ok !== "boolean") throw new Error("The layout response could not be correlated. Reload before retrying.");
  if (!response.ok) {
    if (typeof response.error?.message !== "string") throw new Error("The layout failure could not be verified. Reload before retrying.");
    throw new LayoutRequestRejected(response.error.message);
  }
  if (!response.result || typeof response.result !== "object" || Array.isArray(response.result)) throw new Error("The layout service returned an invalid result.");
  return response.result;
}

/** Read after subscribing, on invalidations and focus. Events carry no layout
 * data or command authority. Cleanup cannot start a missed late subscription. */
export function connectWorkspaceLayout(changed: () => void, failed: (message: string) => void) {
  if (!isTauri()) return () => {};
  let active = true, timer: ReturnType<typeof setTimeout> | undefined, stop: (() => void) | undefined;
  const schedule = () => {
    if (!active) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; if (active) changed(); }, 50);
  };
  window.addEventListener("focus", schedule);
  void listen("xlog:workspace-layout", schedule).then(dispose => {
    if (!active) { dispose(); return; }
    stop = dispose; schedule();
  }).catch(() => { if (active) failed("Live layout updates are unavailable. Refocus this window to reload."); });
  return () => { active = false; clearTimeout(timer); stop?.(); window.removeEventListener("focus", schedule); };
}
