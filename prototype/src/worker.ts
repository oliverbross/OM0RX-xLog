import { invoke, isTauri } from "@tauri-apps/api/core";
export const desktop = isTauri();
export async function workerRequest(
  method: string,
  params: Record<string, unknown> = {},
) {
  if (!desktop)
    throw new Error(
      "The browser cannot connect to station services. Launch OM0RX-xLog Integration on your desktop.",
    );
  const response = await invoke<{
    id: string;
    ok: boolean;
    result?: unknown;
    error?: { code?: string; message?: string };
  }>("worker_request", {
    request: { id: crypto.randomUUID(), method, params },
  });
  if (!response.ok)
    throw new Error(
      response.error?.message || "The operation failed; no successful outcome was confirmed.",
    );
  return response;
}
export async function openMonitor() {
  if (desktop) {
    await invoke("open_monitor");
    return "Detached station monitor opened";
  }
  const w = window.open(
    `${window.location.pathname}?view=monitor`,
    "xlog-p1-monitor",
    "width=760,height=660",
  );
  if (!w)
    throw new Error("Monitor preview was blocked. Allow popups and try again.");
  return "Browser monitor preview opened";
}
