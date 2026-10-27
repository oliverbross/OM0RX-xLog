import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { flushUnfinishedEditors } from "./contesting/unfinishedEditors";

export type OperatingModuleTransitionController = {
  freeze: () => void;
  prepare: () => Promise<void>;
  resume: () => void;
};

type TransitionEvent = { request: string };

/** Keeps the contest renderer frozen only after its buffered entry has been
 * durably flushed. Native retirement cannot start until the correlated ack. */
export function prepareOperatingModuleTransition(controller: () => OperatingModuleTransitionController | null) {
  let active = true, preparedRequest: string | null = null, preparingRequest: string | null = null;
  const cancelled = new Set<string>();
  const stops: Array<() => void> = [];

  const prepare = async (request: string) => {
    const current = controller();
    if (request === preparingRequest || request === preparedRequest) return;
    if (!active || !current || preparingRequest !== null || preparedRequest !== null) {
      if (active) await invoke("operating_module_transition_ack", { request, ready: false }).catch(() => undefined);
      return;
    }
    preparingRequest = request;
    current.freeze();
    let ready = false, reason: string | undefined;
    try {
      flushUnfinishedEditors();
      await current.prepare();
      if (active && !cancelled.has(request)) {
        preparedRequest = request;
        ready = true;
      } else {
        current.resume();
      }
    } catch (cause) {
      reason = cause instanceof Error ? cause.message : String(cause);
      current.resume();
    } finally {
      preparingRequest = null;
    }
    try {
      if (active) await invoke("operating_module_transition_ack", { request, ready, ...(reason ? { reason } : {}) });
    } catch {
      if (ready && preparedRequest === request) {
        preparedRequest = null;
        current.resume();
      }
    }
  };

  void Promise.all([
    listen<TransitionEvent>("xlog:operating-module-prepare", event => {
      if (typeof event.payload?.request === "string") void prepare(event.payload.request);
    }),
    listen<TransitionEvent>("xlog:operating-module-cancel", event => {
      const request = event.payload?.request;
      if (typeof request !== "string") return;
      cancelled.add(request);
      if (request === preparedRequest || request === preparingRequest) controller()?.resume();
      if (request === preparedRequest) preparedRequest = null;
    }),
  ]).then(async dispose => {
    if (active) stops.push(...dispose); else dispose.forEach(stop => stop());
    // Recover a request sent before this renderer installed its listeners.
    if (active) {
      const pending = await invoke<string | null>("operating_module_transition_pending");
      if (active && typeof pending === "string") await prepare(pending);
    }
  }).catch(() => { /* Native preflight times out safely if listeners cannot install. */ });

  return () => {
    active = false;
    if (preparedRequest !== null || preparingRequest !== null) controller()?.resume();
    stops.forEach(stop => stop());
  };
}

/** Detached editors already own close vetoes. Freeze their input for the whole
 * restart preflight so an acknowledged editor cannot receive new unsaved text. */
export function prepareOperatingModuleEditor(blocked: () => boolean, explain: () => void) {
  let inert = false;
  return prepareOperatingModuleTransition(() => ({
    freeze: () => { inert = document.body.inert; document.body.inert = true; },
    prepare: async () => {
      if (blocked()) { explain(); throw new Error("Finish or cancel unsaved editor changes before changing operating module."); }
    },
    resume: () => { document.body.inert = inert; },
  }));
}
