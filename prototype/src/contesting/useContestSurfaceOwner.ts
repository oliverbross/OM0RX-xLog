import { useCallback, useEffect, useRef } from "react";
import { claimContestSurfaceOwner, closeContestSurfaceContext, completeContestSurfaceAction, nextContestSurfaceAction, nextContestSurfaceEscape, onContestSurfaceWake,
  publishContestSurface, type ContestSurfaceContext } from "./contestSurfaceNative";
import { ContestMutationUncertain } from "./client";
import { contestSurfacePanelIDs, validContestSurfaceUUID, type ContestSurfaceActionEnvelope,
  type ContestSurfacePanelID, type ContestSurfaceProjection } from "./contestSurfaceProtocol";

type Projections = Record<ContestSurfacePanelID, ContestSurfaceProjection>;
export type ContestSurfaceActionDisposition = void | "native-completed";
type Owner = { context: ContestSurfaceContext | null; projections: Projections;
  handle: (action: ContestSurfaceActionEnvelope) => Promise<ContestSurfaceActionDisposition>; report: (message: string) => void };
const boundedMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).slice(0, 512);
const sameContext = (current: ContestSurfaceContext | null, expected: ContestSurfaceContext) =>
  current?.operatingContext === expected.operatingContext && current.sessionID === expected.sessionID &&
  current.workspaceGeneration === expected.workspaceGeneration;
const rebasablePresentationActions = new Set<ContestSurfaceActionEnvelope["action"]>([
  "entry_set_text", "entry_set_exchange", "entry_set_frequency_text", "entry_set_band", "entry_set_mode", "assistance_query",
  "log_edit_set_text", "log_edit_set_exchange", "log_edit_set_frequency_text", "log_edit_set_band", "log_edit_confirm_delete",
]);

/** Keeps the single mounted ContestWorkspace authoritative. Wake events carry no
 * state; every action and projection is reread through the typed native bridge. */
export function useContestSurfaceOwner({ context, projections, handle, report }: Owner) {
  const key = JSON.stringify(projections), keyRef = useRef(""), revisionRef = useRef(0), issuedRevisionRef = useRef(0), publishedRevisionRef = useRef(0);
  const contextKey = context ? `${context.operatingContext}:${context.sessionID}:${context.workspaceGeneration}` : "";
  const ownerRef = useRef<{ contextKey:string; ownerEpoch:string; claim:Promise<number>|null }>({contextKey:"",ownerEpoch:"",claim:null});
  if(ownerRef.current.contextKey!==contextKey)ownerRef.current={contextKey,ownerEpoch:crypto.randomUUID(),claim:null};
  if (keyRef.current !== key) { keyRef.current = key; revisionRef.current += 1; }
  const contextRef = useRef(context), projectionsRef = useRef(projections), handleRef = useRef(handle);
  contextRef.current = context; projectionsRef.current = projections; handleRef.current = handle;
  const publishQueue = useRef(Promise.resolve());
  const currentPublication = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!context || !validContestSurfaceUUID(context.operatingContext) || !validContestSurfaceUUID(context.sessionID) ||
        !validContestSurfaceUUID(context.workspaceGeneration)) return;
    const snapshot = projections, owner = ownerRef.current;
    const publication = publishQueue.current.then(async () => {
      if (!sameContext(contextRef.current, context)) return;
      owner.claim ??= claimContestSurfaceOwner({ ...context, ownerEpoch: owner.ownerEpoch });
      const retainedRevision = await owner.claim;
      if (!sameContext(contextRef.current, context) || ownerRef.current !== owner) return;
      const revision = Math.max(revisionRef.current, retainedRevision + 1, issuedRevisionRef.current + 1);
      revisionRef.current = revision; issuedRevisionRef.current = revision;
      await Promise.all(contestSurfacePanelIDs.map(panelID => publishContestSurface({ ...context, scope: "contesting", panelID,
        ownerEpoch: owner.ownerEpoch, projectionRevision: revision, projection: snapshot[panelID] })));
      publishedRevisionRef.current = Math.max(publishedRevisionRef.current, revision);
    });
    currentPublication.current = publication;
    publishQueue.current = publication.catch(cause => {
      // Native admission must still reject the old publication. A rejection
      // that settles after its owner context changed is the expected session
      // handoff, not an operator-facing failure in the newly active contest.
      if (sameContext(contextRef.current, context)) report(boundedMessage(cause));
    });
  }, [context?.operatingContext, context?.sessionID, context?.workspaceGeneration, key, report]);

  const waitForPublication = useCallback(() => currentPublication.current, []);

  useEffect(() => {
    if (!context || !validContestSurfaceUUID(context.operatingContext) || !validContestSurfaceUUID(context.sessionID) ||
        !validContestSurfaceUUID(context.workspaceGeneration)) return;
    const ownerEpoch = ownerRef.current.ownerEpoch;
    let active = true, draining = false, dirty = false, stop: (() => void) | undefined;
    const drain = async () => {
      if (!active) return;
      if (draining) { dirty = true; return; }
      draining = true;
      try {
        for (let count = 0; active && count < 64; count += 1) {
          const action = await nextContestSurfaceAction(context);
          if (!active || action === null) break;
          let admitted = false;
          try {
            if (action.projectionRevision !== revisionRef.current && !rebasablePresentationActions.has(action.action))
              throw new Error("The contest panel changed before this action reached the owner.");
            if (projectionsRef.current[action.panelID].status !== "ready")
              throw new Error("The requested contest panel is not available.");
            admitted = true;
            const disposition = await handleRef.current(action);
            if (disposition === "native-completed") continue;
            if (rebasablePresentationActions.has(action.action)) {
              await new Promise<void>(resolve => window.setTimeout(resolve, 0));
              await currentPublication.current;
            }
          } catch (cause) {
            // `next` has already marked the native receipt uncertain. Once a
            // mutation may have reached the worker, never rewrite that receipt
            // as rejected or replay the action from this owner.
            if (admitted && cause instanceof ContestMutationUncertain) { report(boundedMessage(cause)); continue; }
            await completeContestSurfaceAction({ ...context, requestID: action.requestID, outcome: "rejected",
              message: boundedMessage(cause), projectionRevision: publishedRevisionRef.current }).catch(error => report(boundedMessage(error)));
            continue;
          }
          await completeContestSurfaceAction({ ...context, requestID: action.requestID, outcome: "applied",
            projectionRevision: publishedRevisionRef.current }).catch(cause => report(boundedMessage(cause)));
        }
      } catch (cause) { if (active) report(boundedMessage(cause)); }
      finally { draining = false; if (active && dirty) { dirty = false; void drain(); } }
    };
    void onContestSurfaceWake(() => void drain()).then(value => { if (active) { stop = value; void drain(); } else value(); })
      .catch(cause => { if (active) report(boundedMessage(cause)); });
    return () => { active = false; stop?.(); void closeContestSurfaceContext({ ...context, ownerEpoch }).catch(() => {}); };
  }, [context?.operatingContext, context?.sessionID, context?.workspaceGeneration, report]);

  useEffect(() => {
    if (!context || !validContestSurfaceUUID(context.operatingContext) || !validContestSurfaceUUID(context.sessionID) ||
        !validContestSurfaceUUID(context.workspaceGeneration)) return;
    let active = true, draining = false, dirty = false, stop: (() => void) | undefined;
    const drainEscape = async () => {
      if (!active) return;
      if (draining) { dirty = true; return; }
      draining = true;
      try {
        for (let count = 0; active && count < 16; count += 1) {
          const action = await nextContestSurfaceEscape(context);
          if (!active || action === null) break;
          try {
            if (projectionsRef.current["active-qso"].status !== "ready")
              throw new Error("The requested contest panel is not available.");
            // Escape is the sole concurrent owner action. Its context identity
            // remains exact, while an in-flight mutation may legitimately make
            // its presentation and draft revisions stale before it is taken.
            await handleRef.current(action);
          } catch (cause) {
            await completeContestSurfaceAction({ ...context, requestID: action.requestID, outcome: "rejected",
              message: boundedMessage(cause), projectionRevision: publishedRevisionRef.current }).catch(error => report(boundedMessage(error)));
            continue;
          }
          await completeContestSurfaceAction({ ...context, requestID: action.requestID, outcome: "applied",
            projectionRevision: publishedRevisionRef.current }).catch(cause => report(boundedMessage(cause)));
        }
      } catch (cause) { if (active) report(boundedMessage(cause)); }
      finally { draining = false; if (active && dirty) { dirty = false; void drainEscape(); } }
    };
    void onContestSurfaceWake(() => void drainEscape()).then(value => { if (active) { stop = value; void drainEscape(); } else value(); })
      .catch(cause => { if (active) report(boundedMessage(cause)); });
    return () => { active = false; stop?.(); };
  }, [context?.operatingContext, context?.sessionID, context?.workspaceGeneration, report]);

  return waitForPublication;
}
