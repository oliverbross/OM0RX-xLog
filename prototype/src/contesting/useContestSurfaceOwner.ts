import { useEffect, useRef } from "react";
import { closeContestSurfaceContext, completeContestSurfaceAction, nextContestSurfaceAction, onContestSurfaceWake,
  publishContestSurface, type ContestSurfaceContext } from "./contestSurfaceNative";
import { ContestMutationUncertain } from "./client";
import { contestSurfacePanelIDs, validContestSurfaceUUID, type ContestSurfaceActionEnvelope,
  type ContestSurfacePanelID, type ContestSurfaceProjection } from "./contestSurfaceProtocol";

type Projections = Record<ContestSurfacePanelID, ContestSurfaceProjection>;
type Owner = { context: ContestSurfaceContext | null; projections: Projections;
  handle: (action: ContestSurfaceActionEnvelope) => Promise<void>; report: (message: string) => void };
const boundedMessage = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause)).slice(0, 512);
const rebasablePresentationActions = new Set<ContestSurfaceActionEnvelope["action"]>([
  "entry_set_text", "entry_set_exchange", "entry_set_frequency_text", "entry_set_band", "entry_set_mode", "assistance_query",
  "log_edit_set_text", "log_edit_set_exchange", "log_edit_set_frequency_text", "log_edit_set_band", "log_edit_confirm_delete",
]);

/** Keeps the single mounted ContestWorkspace authoritative. Wake events carry no
 * state; every action and projection is reread through the typed native bridge. */
export function useContestSurfaceOwner({ context, projections, handle, report }: Owner) {
  const key = JSON.stringify(projections), keyRef = useRef(""), revisionRef = useRef(0);
  if (keyRef.current !== key) { keyRef.current = key; revisionRef.current += 1; }
  const contextRef = useRef(context), projectionsRef = useRef(projections), handleRef = useRef(handle);
  contextRef.current = context; projectionsRef.current = projections; handleRef.current = handle;
  const publishQueue = useRef(Promise.resolve());

  useEffect(() => {
    if (!context || !validContestSurfaceUUID(context.operatingContext) || !validContestSurfaceUUID(context.sessionID) ||
        !validContestSurfaceUUID(context.workspaceGeneration)) return;
    const revision = revisionRef.current, snapshot = projections;
    publishQueue.current = publishQueue.current.then(async () => {
      if (contextRef.current?.sessionID !== context.sessionID || contextRef.current.workspaceGeneration !== context.workspaceGeneration) return;
      await Promise.all(contestSurfacePanelIDs.map(panelID => publishContestSurface({ ...context, scope: "contesting", panelID,
        projectionRevision: revision, projection: snapshot[panelID] })));
    }).catch(cause => report(boundedMessage(cause)));
  }, [context?.operatingContext, context?.sessionID, context?.workspaceGeneration, key, report]);

  useEffect(() => {
    if (!context || !validContestSurfaceUUID(context.operatingContext) || !validContestSurfaceUUID(context.sessionID) ||
        !validContestSurfaceUUID(context.workspaceGeneration)) return;
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
            await handleRef.current(action);
          } catch (cause) {
            // `next` has already marked the native receipt uncertain. Once a
            // mutation may have reached the worker, never rewrite that receipt
            // as rejected or replay the action from this owner.
            if (admitted && cause instanceof ContestMutationUncertain) { report(boundedMessage(cause)); continue; }
            await completeContestSurfaceAction({ ...context, requestID: action.requestID, outcome: "rejected",
              message: boundedMessage(cause), projectionRevision: revisionRef.current }).catch(error => report(boundedMessage(error)));
            continue;
          }
          await completeContestSurfaceAction({ ...context, requestID: action.requestID, outcome: "applied",
            projectionRevision: revisionRef.current }).catch(cause => report(boundedMessage(cause)));
        }
      } catch (cause) { if (active) report(boundedMessage(cause)); }
      finally { draining = false; if (active && dirty) { dirty = false; void drain(); } }
    };
    void onContestSurfaceWake(() => void drain()).then(value => { if (active) { stop = value; void drain(); } else value(); })
      .catch(cause => { if (active) report(boundedMessage(cause)); });
    return () => { active = false; stop?.(); void closeContestSurfaceContext(context).catch(() => {}); };
  }, [context?.operatingContext, context?.sessionID, context?.workspaceGeneration, report]);
}
