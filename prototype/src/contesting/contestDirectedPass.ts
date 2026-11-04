import { requestContestGroupAuthority, type ContestDirectedProposal, type ContestGroupCoordination } from "./contestGroupChat";
import type { ContestSurfaceContext } from "./contestSurfaceNative";

export function directedPassComplete(item: ContestDirectedProposal) {
  return item.schema === 2 && item.version === 1 && ["pass", "helper"].includes(item.kind) &&
    item.frequencyMeaning === "rx" && Number.isSafeInteger(item.frequencyHz) && item.frequencyHz > 0 &&
    ["CW", "SSB", "RTTY"].includes(item.mode) && ["laneA", "laneB"].includes(item.laneID) &&
    typeof item.observedUTC === "string" && Number.isFinite(Date.parse(item.observedUTC)) &&
    !item.superseded && !item.recipientActions?.some(action => action.event === "declined");
}

/** Re-read through the admitted authority: renderer-carried calls/frequencies are never used. */
export async function readDirectedPass(context: ContestSurfaceContext, messageID: string, messageVersion: number) {
  const group = await requestContestGroupAuthority(context, "coordination", { action: "read" }) as ContestGroupCoordination;
  const proposal = group.directed.find(item => item.id === messageID);
  if (!proposal || proposal.target !== group.senderStation) throw new Error("This proposal is not addressed to this station.");
  if (!directedPassComplete(proposal) || proposal.version !== messageVersion ||
      proposal.sessionID !== group.authority.sessionID || proposal.workspaceGeneration !== group.authority.workspaceGeneration)
    throw new Error("This pass is incomplete, superseded, declined or belongs to another authority context.");
  return proposal;
}

/** Requested, provider acceptance and observable confirmation are distinct durable receipts. */
export async function journalDirectedPass(context: ContestSurfaceContext, proposal: ContestDirectedProposal,
    operationID: string, event: "load_requested" | "loaded" | "tune_requested" | "tune_accepted" | "failed" | "uncertain",
    capturedContext: Record<string, unknown>, detail = "") {
  await requestContestGroupAuthority(context, "coordination", { action: "recipient_action", messageID: proposal.id,
    messageVersion: proposal.version, operationID, event, context: capturedContext, detail: detail.slice(0, 512) });
}

export type DirectedPassOperation = "load" | "tune" | "park";
export type DirectedPassPorts = {
  context: ContestSurfaceContext;
  /** Verifies the original workspace/draft/lane/binding/generation again after authority I/O. */
  isCurrent: () => boolean;
  occupied: () => boolean;
  load: (proposal: ContestDirectedProposal) => Promise<void>;
  tune: (proposal: ContestDirectedProposal) => Promise<void>;
  parkAndLoad: (proposal: ContestDirectedProposal) => Promise<void>;
};

/** The durable requested receipt fences every effect, including a retry after a lost reply. */
export async function executeDirectedPass(proposal: ContestDirectedProposal, operationID: string,
    operation: DirectedPassOperation, capturedContext: Record<string, unknown>, ports: DirectedPassPorts) {
  proposal = structuredClone(proposal);
  capturedContext = structuredClone(capturedContext);
  if (!directedPassComplete(proposal) || !ports.isCurrent()) throw new Error("Directed pass owner context changed before admission.");
  if (operation === "load" && ports.occupied()) throw new Error("Entry is occupied. Use the explicit Park current entry and load pass action.");
  const requested = operation === "tune" ? "tune_requested" : "load_requested";
  // Failure/lost reply here must never dispatch. A persisted request rejects retry of the operationID.
  await journalDirectedPass(ports.context, proposal, operationID, requested, capturedContext);
  let attempted = false;
  try {
    if (!ports.isCurrent()) throw new Error("Directed pass owner context changed during admission.");
    if (operation === "load" && ports.occupied()) throw new Error("Entry became occupied during pass admission.");
    attempted = true;
    if (operation === "tune") await ports.tune(proposal);
    else if (operation === "park") await ports.parkAndLoad(proposal);
    else await ports.load(proposal);
    await journalDirectedPass(ports.context, proposal, operationID, operation === "tune" ? "tune_accepted" : "loaded", capturedContext,
      operation === "tune" ? "Owner accepted the CAT command; observed frequency and split/TX remain unverified." :
        operation === "park" ? "Existing draft parked before this pass was explicitly loaded." : "Pass loaded through the current contest draft owner.");
  } catch (cause) {
    // Persistence after the effect is ancillary: retain the original requested fence if it fails.
    try { await journalDirectedPass(ports.context, proposal, operationID, attempted ? "uncertain" : "failed", capturedContext,
      String(cause instanceof Error ? cause.message : cause)); } catch { /* original durable request remains unresolved */ }
    throw cause;
  }
}
