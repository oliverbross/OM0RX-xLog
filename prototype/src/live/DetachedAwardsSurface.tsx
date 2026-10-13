import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { workerRequest } from "../worker";
import AwardsPanel from "./AwardsPanel";
import { connectLogbookChanges } from "./logbookWindows";
import { dockDetachedWorkspace } from "./DetachedClusterBridge";

export async function openDetachedAwards() {
  if (!isTauri()) throw new Error("Undocking requires the desktop application.");
  await invoke("open_detached_map", { kind: "awards" });
}
async function request(method: string, params: Record<string, unknown> = {}) {
  return (await workerRequest(method, params)).result;
}
export function DetachedAwardsSurface() {
  const [refresh, setRefresh] = useState(0), [error, setError] = useState("");
  useEffect(() => connectLogbookChanges(() => setRefresh(value => value + 1), setError), []);
  return <div className="app live monitor-app detached-awards-app"><main aria-label="Detached Awards">
    {error && <p className="live-error" role="alert">{error}</p>}
    <AwardsPanel request={request} refresh={refresh} onDock={() => {
      setError("");
      void dockDetachedWorkspace().catch(() => setError("Could not dock Awards. Try again after opening the main workspace."));
    }} />
  </main></div>;
}
