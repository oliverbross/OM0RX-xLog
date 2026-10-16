import { useEffect, useMemo } from "react";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
const catalogueParams = { offset: 0, limit: 5, search: "", delivery_state: "" };

function localKey(method: string, params?: Record<string, unknown>): string | null {
  if (method === "opportunities_snapshot" && (!params || Object.keys(params).length === 0)) return method;
  if (method === "logbook_catalog" && params && Object.keys(params).length === 4
    && Object.entries(catalogueParams).every(([key, value]) => params[key] === value)) return method;
  return null;
}

/** Retain local panel reads for the current logbook revision; Chaser expires at its normal poll interval. */
export function createDeferredPanelReads(request: Request) {
  const pending = new Map<string, { promise: Promise<any>; settledAt?: number }>();
  let warmed = false;
  const load = (key: string, method: string, params?: Record<string, unknown>) => {
    let existing = pending.get(key);
    // Match Chaser's local polling interval: a long stay on the desk must not revive expired activity.
    if (existing?.settledAt !== undefined && key === "opportunities_snapshot" && Date.now() - existing.settledAt >= 15_000) {
      pending.delete(key); existing = undefined;
    }
    if (existing) return existing.promise;
    const entry: { promise: Promise<any>; settledAt?: number } = { promise: params ? request(method, params) : request(method) };
    pending.set(key, entry);
    void entry.promise.then(() => {
      entry.settledAt = Date.now();
    }, () => { if (pending.get(key) === entry) pending.delete(key); });
    return entry.promise;
  };
  return {
    request: ((method, params) => {
      const key = localKey(method, params);
      return key ? load(key, method, params) : request(method, params);
    }) as Request,
    warm() {
      if (warmed) return;
      warmed = true;
      // These commands read retained/local data. Feed refreshes belong to the visible Chaser lifecycle.
      void Promise.allSettled([
        load("opportunities_snapshot", "opportunities_snapshot"),
        load("logbook_catalog", "logbook_catalog", catalogueParams),
      ]);
    },
  };
}

export function useDeferredPanelReads(request: Request, revision: number, enabled: boolean): Request {
  // A logbook mutation retires both retained results and their pending promises.
  const reads = useMemo(() => createDeferredPanelReads(request), [request, revision]);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0, idle: number | undefined, timer: number | undefined;
    // Two frames allow Operator Desk to paint before even scheduling optional local work.
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(() => reads.warm());
        else timer = window.setTimeout(() => reads.warm(), 0);
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [reads, enabled]);
  return reads.request;
}
