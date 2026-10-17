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
  type Entry = { promise: Promise<any>; startedAt: number; settledAt?: number };
  const pending = new Map<string, Entry>();
  let latestSnapshotTime = -Infinity;
  let latestSnapshotOrder = 0, order = 0;
  let warmed = false;
  const retainSnapshot = (value: any, entry: Entry, responseOrder: number, key: string) => {
    const generatedAt = Date.parse(value?.generated_at);
    if (!Array.isArray(value?.items) || !Number.isFinite(generatedAt)) return;
    if (generatedAt < latestSnapshotTime || (generatedAt === latestSnapshotTime && responseOrder < latestSnapshotOrder)) return;
    latestSnapshotTime = generatedAt; latestSnapshotOrder = responseOrder;
    if (key !== "opportunities_snapshot") pending.set("opportunities_snapshot", { ...entry, promise: Promise.resolve(value), settledAt: Date.now() });
  };
  const load = (key: string, method: string, params?: Record<string, unknown>) => {
    let existing = pending.get(key);
    // Age from request start: a slow response must not buy another full freshness interval.
    const ttl = key === "opportunities_snapshot" ? 15_000 : key.startsWith("refresh:") ? 60_000 : Infinity;
    if (existing?.settledAt !== undefined && Date.now() - existing.startedAt >= ttl) {
      pending.delete(key); existing = undefined;
    }
    if (existing) {
      // A completed refresh is a cooldown, not permission to replay its older
      // projection. Use the current local snapshot (or its normal 15s read).
      if (key.startsWith("refresh:") && existing.settledAt !== undefined) return load("opportunities_snapshot", "opportunities_snapshot");
      return existing.promise;
    }
    const responseOrder = ++order;
    const entry: Entry = { promise: params ? request(method, params) : request(method), startedAt: Date.now() };
    pending.set(key, entry);
    void entry.promise.then(value => {
      entry.settledAt = Date.now();
      if (method.startsWith("opportunities_") && pending.get(key) === entry) retainSnapshot(value, entry, responseOrder, key);
    }, () => { if (pending.get(key) === entry) pending.delete(key); });
    return entry.promise;
  };
  return {
    request: ((method, params) => {
      const key = localKey(method, params);
      // Share the visible panel's work across remounts; warm() never starts feeds.
      if (method === "opportunities_refresh" && params?.automatic === true
        && Object.keys(params).length === 2 && typeof params.source === "string") {
        return load(`refresh:${params.source}`, method, params);
      }
      if (method === "opportunities_refresh") {
        for (const key of pending.keys()) if (key.startsWith("refresh:")) pending.delete(key);
        const key = `manual:${++order}`;
        return load(key, method, params).finally(() => { pending.delete(key); });
      }
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
