import { useEffect, useMemo, useRef, useState } from "react";
import { ContestCallStackPanel } from "./ContestCallStackPanel";
import { ContestCallStack, callStackStorageKey, occupiedStackDraft, partialStackCall, restoreCallStack,
  type CallStackClassification, type CallStackDraft, type CallStackItem, type CallStackOperation,
  type CallStackResult, type CallStackState } from "./contestCallStack";

export function callStackClassificationScope(draft: CallStackDraft) {
  const legacy = `${draft.workspaceGeneration}/${draft.sessionID}/${draft.draftID}/${draft.revision}`;
  return draft.laneID ? `${legacy}/${draft.laneID}/${draft.bindingVersion ?? "unknown"}/${draft.bindingGeneration ?? "unknown"}` : legacy;
}
export type ContestCallStackOwnerProps = {
  draft: CallStackDraft;
  /** Read the existing owner's synchronous projection/field refs between a save and the next React render. */
  getDraft?(): CallStackDraft;
  disabled: boolean;
  mutate(operation: CallStackOperation): Promise<CallStackResult>;
  receipt(operation: CallStackOperation): Promise<CallStackResult | null>;
  classify(items: CallStackItem[], draft: CallStackDraft, scope: string): Promise<CallStackClassification[]>;
  /** Include band/mode/timed-rule context here if it can change without a host revision. */
  classificationScope?: string;
  /** Only a definitive host rejection may release the pending immutable operation. */
  rejected?(cause: unknown): boolean;
  onError(message: string): void;
};
function message(cause: unknown) { return cause instanceof Error ? cause.message : String(cause); }

/** UI lifecycle for the one existing Python session owner, with no request or native transport of its own. */
export function ContestCallStackOwner(props: ContestCallStackOwnerProps) {
  return <ScopedContestCallStackOwner key={callStackStorageKey(props.draft)} {...props}/>;
}
function ScopedContestCallStackOwner(props: ContestCallStackOwnerProps) {
  const latest = useRef(props); latest.current = props;
  const [published, setPublished] = useState<CallStackState | null>(null);
  const [classifications, setClassifications] = useState<CallStackClassification[]>([]);
  const holder = useMemo(() => {
    try {
      const scope = { sessionID: props.draft.sessionID, workspaceGeneration: props.draft.workspaceGeneration,
        ...(props.draft.laneID ? { laneID: props.draft.laneID } : {}) };
      const key = callStackStorageKey(scope), state = restoreCallStack(localStorage.getItem(key), scope);
      const controller = new ContestCallStack(state, {
        getDraft: () => latest.current.getDraft?.() ?? latest.current.draft,
        persist: value => localStorage.setItem(key, JSON.stringify(value)),
        changed: setPublished,
        mutate: operation => latest.current.mutate(operation),
        receipt: operation => latest.current.receipt(operation),
        rejected: cause => latest.current.rejected?.(cause) === true,
      });
      return { controller, error: "" };
    } catch (cause) { return { controller: null, error: message(cause) }; }
  }, [props.draft.sessionID, props.draft.workspaceGeneration]);
  useEffect(() => {
    setPublished(holder.controller?.snapshot() ?? null);
    if (holder.error) latest.current.onError(holder.error);
  }, [holder]);
  const state = holder.controller && published?.sessionID === props.draft.sessionID &&
    published.workspaceGeneration === props.draft.workspaceGeneration && (published.laneID ?? "laneA") === (props.draft.laneID ?? "laneA")
    ? published : holder.controller?.snapshot();
  const classificationScope = props.classificationScope ?? callStackClassificationScope(props.draft);
  useEffect(() => {
    let active = true; setClassifications([]);
    if (!state || props.disabled) return;
    const items = state.items.filter(item => !partialStackCall(item.callsign));
    if (!items.length) return;
    const draft = structuredClone(props.draft);
    void latest.current.classify(structuredClone(items), draft, classificationScope).then(values => {
      if (!active) return;
      setClassifications(values.filter(value => value.scope === classificationScope &&
        items.some(item => item.id === value.itemID && item.revision === value.itemRevision)));
    }).catch(() => { /* Keep unknown visible; authority absence never removes a caller or changes Entry. */ });
    return () => { active = false; };
  }, [holder, state?.revision, classificationScope, props.disabled]);
  const run = (action: (controller: ContestCallStack) => unknown) => {
    if (props.disabled || !holder.controller) return;
    try { void Promise.resolve(action(holder.controller)).catch(cause => latest.current.onError(message(cause))); }
    catch (cause) { latest.current.onError(message(cause)); }
  };
  if (!holder.controller || !state) return <section aria-label="Call Stack"><h2>Call Stack</h2>
    <p role="alert">{holder.error || "Call Stack is unavailable."} Saved recovery data has been preserved.</p></section>;
  return <ContestCallStackPanel state={state} disabled={props.disabled} occupied={occupiedStackDraft(props.draft)}
    currentCallsign={props.draft.fields.callsign ?? ""} classifications={classifications} classificationScope={classificationScope}
    onAdd={callsign => run(controller => controller.add(callsign))}
    onSelect={id => run(controller => controller.select(id))} onPromote={id => run(controller => controller.promote(id))}
    onRemove={id => run(controller => controller.remove(id))} onLoad={(id, decision) => run(controller => controller.load(id, decision))}
    onLogNext={() => run(controller => controller.logAndNext())} onRecover={retry => run(controller => controller.recover(retry))}
    onKeepQueue={() => run(controller => controller.keepQueueAfterSavedContact())}/>;
}
