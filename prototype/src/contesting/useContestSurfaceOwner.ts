import { useEffect, useRef } from "react";
import { closeContestSurfaceContext, completeContestSurfaceAction, nextContestSurfaceAction, nextContestSurfaceEscape, onContestSurfaceWake,
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
  const keys = Object.fromEntries(contestSurfacePanelIDs.map(panelID => [panelID, JSON.stringify(projections[panelID])])) as Record<ContestSurfacePanelID, string>;
  const key = contestSurfacePanelIDs.map(panelID => keys[panelID]).join("\u0000");
  const keyRef = useRef({} as Partial<Record<ContestSurfacePanelID, string>>), revisionRef = useRef({} as Record<ContestSurfacePanelID, number>);
  for (const panelID of contestSurfacePanelIDs) if (keyRef.current[panelID] !== keys[panelID]) {
    keyRef.current[panelID] = keys[panelID]; revisionRef.current[panelID] = (revisionRef.current[panelID] ?? 0) + 1;
  }
  const contextRef = useRef(context), projectionsRef = useRef(projections), handleRef = useRef(handle);
  contextRef.current = context; projectionsRef.current = projections; handleRef.current = handle;
  const publishQueue = useRef(Promise.resolve());
  const scheduledRef = useRef({ context: "", keys: {} as Partial<Record<ContestSurfacePanelID, string>> });

  useEffect(() => {
    if (!context || !validContestSurfaceUUID(context.operatingContext) || !validContestSurfaceUUID(context.sessionID) ||
        !validContestSurfaceUUID(context.workspaceGeneration)) return;
    const contextKey = `${context.operatingContext}/${context.sessionID}/${context.workspaceGeneration}`;
    if (scheduledRef.current.context !== contextKey) scheduledRef.current = { context: contextKey, keys: {} };
    const changed = contestSurfacePanelIDs.filter(panelID => scheduledRef.current.keys[panelID] !== keys[panelID]);
    if (changed.length === 0) return;
    const revisions = { ...revisionRef.current }, snapshot = projections, snapshotKeys = { ...keys };
    for (const panelID of changed) scheduledRef.current.keys[panelID] = snapshotKeys[panelID];
    publishQueue.current = publishQueue.current.then(async () => {
      if (contextRef.current?.operatingContext !== context.operatingContext || contextRef.current.sessionID !== context.sessionID ||
          contextRef.current.workspaceGeneration !== context.workspaceGeneration) return;
      await Promise.all(changed.map(panelID => publishContestSurface({ ...context, scope: "contesting", panelID,
        projectionRevision: revisions[panelID], projection: snapshot[panelID] })));
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
            if (action.projectionRevision !== revisionRef.current[action.panelID] && !rebasablePresentationActions.has(action.action))
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
              message: boundedMessage(cause), projectionRevision: revisionRef.current[action.panelID] }).catch(error => report(boundedMessage(error)));
            continue;
          }
          await completeContestSurfaceAction({ ...context, requestID: action.requestID, outcome: "applied",
            projectionRevision: revisionRef.current[action.panelID] }).catch(cause => report(boundedMessage(cause)));
        }
      } catch (cause) { if (active) report(boundedMessage(cause)); }
      finally { draining = false; if (active && dirty) { dirty = false; void drain(); } }
    };
    void onContestSurfaceWake(() => void drain()).then(value => { if (active) { stop = value; void drain(); } else value(); })
      .catch(cause => { if (active) report(boundedMessage(cause)); });
    return () => { active = false; stop?.(); void closeContestSurfaceContext(context).catch(() => {}); };
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
              message: boundedMessage(cause), projectionRevision: revisionRef.current["active-qso"] }).catch(error => report(boundedMessage(error)));
            continue;
          }
          await completeContestSurfaceAction({ ...context, requestID: action.requestID, outcome: "applied",
            projectionRevision: revisionRef.current["active-qso"] }).catch(cause => report(boundedMessage(cause)));
        }
      } catch (cause) { if (active) report(boundedMessage(cause)); }
      finally { draining = false; if (active && dirty) { dirty = false; void drainEscape(); } }
    };
    void onContestSurfaceWake(() => void drainEscape()).then(value => { if (active) { stop = value; void drainEscape(); } else value(); })
      .catch(cause => { if (active) report(boundedMessage(cause)); });
    return () => { active = false; stop?.(); };
  }, [context?.operatingContext, context?.sessionID, context?.workspaceGeneration, report]);
}
