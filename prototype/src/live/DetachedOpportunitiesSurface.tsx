import { useState } from "react";
import { workerRequest } from "../worker";
import OpportunitiesPanel from "./OpportunitiesPanel";
import { dockDetachedWorkspace } from "./DetachedClusterBridge";
import { useSpotActivation } from "./useSpotActivation";
import { SpotActivationStatus } from "./SpotActivationStatus";
import { activationMessage } from "./spotActivationClient";

export const detachedOpportunityMethods = ["opportunities_snapshot", "opportunities_refresh"] as const;

export async function requestDetachedOpportunity(method: string, params: Record<string, unknown> = {}) {
  if (!detachedOpportunityMethods.includes(method as typeof detachedOpportunityMethods[number]))
    throw new Error("This operation is unavailable in the Chaser & DX window.");
  const result = (await workerRequest(method, params)).result;
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("The Chaser & DX response could not be verified.");
  return result as Record<string, unknown>;
}

export function DetachedOpportunitiesSurface() {
  const [error, setError] = useState("");
  const activation = useSpotActivation("activate_opportunity");
  const dock = () => {
    setError("");
    void dockDetachedWorkspace().catch(() => setError("Could not dock Chaser & DX. Try again after opening the main workspace."));
  };
  return <div className="app live monitor-app detached-opportunities-app"><main aria-label="Detached Chaser & DX">
    {error && <p className="live-error" role="alert">{error}</p>}
    <SpotActivationStatus status={activation.status} error={activation.error} checking={activation.requesting} reconcile={() => void activation.reconcile()} />
    {activation.status?.phase === "confirmed" && activation.status.draftOnly && <p role="status">{activationMessage(activation.status)}</p>}
    <OpportunitiesPanel request={requestDetachedOpportunity} onDock={dock} onSelect={item => {
      setError(""); void activation.activate(item).catch(cause => setError(cause instanceof Error ? cause.message : "Opportunity selection could not be verified."));
    }} />
  </main></div>;
}
