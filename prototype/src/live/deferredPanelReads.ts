import { useEffect, useMemo, useRef } from "react";
import { useDocumentVisible } from "./useDocumentVisible";

type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
const catalogueParams = { offset: 0, limit: 5, search: "", delivery_state: "" };
const firstLogbookPage = { search: "", offset: 0, limit: 20 };

function localKey(method: string, params?: Record<string, unknown>): string | null {
  if (method === "opportunities_snapshot" && (!params || Object.keys(params).length === 0)) return method;
  // Five demand-filled frames retain at most the first 100 unfiltered contacts.
  // Only the first 20 are prewarmed; navigation can join later pending frames.
  if (method === "logbook_list" && params && Object.keys(params).length === 3 && params.search === ""
    && params.limit === 20 && Number.isSafeInteger(params.offset) && Number(params.offset) >= 0
    && Number(params.offset) < 100 && Number(params.offset) % 20 === 0) return `${method}:${params.offset}`;
  if (method === "logbook_catalog" && params && Object.keys(params).length === 4
    && Object.entries(catalogueParams).every(([key, value]) => params[key] === value)) return method;
  return null;
}

/** Retain local panel reads for the current logbook revision; Chaser expires at its normal poll interval. */
export function createDeferredPanelReads(request: Request, warmLogbook = false) {
  type Entry = { promise: Promise<any>; startedAt: number; settledAt?: number };
  const pending = new Map<string, Entry>();
  let latestSnapshotTime = -Infinity;
  let latestSnapshotOrder = 0, order = 0;
  let warmed = false;
  let scopeVersion = 0;
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
    const responseOrder = ++order, version = scopeVersion;
    const invoke = () => params ? request(method, params) : request(method);
    // The worker serializes these reads. Await the page response, rather than
    // just invoking it first: worker tasks may otherwise admit the aggregate first.
    const pageFirst = warmLogbook && (method === "logbook_catalog" || method === "opportunities_snapshot");
    const promise = pageFirst ? afterFirstPage(version, invoke) : invoke();
    const entry: Entry = { promise, startedAt: Date.now() };
    pending.set(key, entry);
    void entry.promise.then(value => {
      entry.settledAt = Date.now();
      if (method.startsWith("opportunities_") && pending.get(key) === entry) retainSnapshot(value, entry, responseOrder, key);
    }, () => { if (pending.get(key) === entry) pending.delete(key); });
    return entry.promise;
  };
  function afterFirstPage(version: number, invoke: () => Promise<any>) {
    return load("logbook_list:0", "logbook_list", firstLogbookPage).then(page => {
      if (version !== scopeVersion) throw new Error("The panel read scope changed.");
      if (!Array.isArray(page?.qsos) || !Number.isSafeInteger(page?.total) || page.total < 0) {
        throw new Error("The first logbook page did not finish loading.");
      }
      return invoke();
    });
  }
  const invalidate = () => {
    scopeVersion++;
    pending.clear(); warmed = false; latestSnapshotTime = -Infinity; latestSnapshotOrder = 0;
  };
  return {
    request: ((method, params) => {
      if (method === "logbook_stats" && warmLogbook) {
        const version = scopeVersion;
        return afterFirstPage(version, () => params ? request(method, params) : request(method));
      }
      // Import batches can change rows before the parent receives its revision
      // notification, including an uncertain reply. Never replay their old page.
      if (method === "logbook_import_adif") {
        invalidate();
        return request(method, params).finally(invalidate);
      }
      // A measured viewport may need only the beginning of a retained frame.
      // Reuse those exact rows without widening any new worker request.
      if (method === "logbook_list" && params && Object.keys(params).length === 3 && params.search === ""
        && Number.isSafeInteger(params.limit) && Number(params.limit) > 0 && Number(params.limit) < 20
        && Number.isSafeInteger(params.offset) && Number(params.offset) >= 0 && Number(params.offset) < 100 && Number(params.offset) % 20 === 0) {
        const frame = pending.get(`logbook_list:${params.offset}`);
        if (frame) return frame.promise.then(value => Array.isArray(value?.qsos)
          ? { ...value, qsos: value.qsos.slice(0, Number(params.limit)), limit: params.limit } : value);
      }
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
        ...(warmLogbook ? [load("logbook_list:0", "logbook_list", firstLogbookPage)] : []),
      ]);
    },
    invalidate,
  };
}

export function useDeferredPanelReads(request: Request, revision: number | string, enabled: boolean, workspace = "current"): Request {
  const visible = useDocumentVisible();
  const background = useRef({ workspace, lastWarm: -Infinity });
  if (background.current.workspace !== workspace) background.current = { workspace, lastWarm: -Infinity };
  // The caller includes workspace and saved-settings identity in its revision.
  // A mutation retires retained results and pending promises together.
  const reads = useMemo(() => createDeferredPanelReads(request, true), [request, revision]);
  // Retire queued aggregate admission when its authority scope changes. An
  // already-running worker read is still fenced by the consumer's scope.
  useEffect(() => () => reads.invalidate(), [reads]);
  useEffect(() => {
    if (!enabled || !visible) return;
    let frame = 0, idle: number | undefined, timer: number | undefined;
    const warm = () => { background.current.lastWarm = Date.now(); reads.warm(); };
    const schedule = () => {
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(warm);
      else timer = window.setTimeout(warm, 0);
    };
    // Two frames allow Operator Desk to paint before even scheduling optional local work.
    frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        // The catalogue is expensive after a contact change. New revisions
        // replace this queued batch, with at most one optional batch per minute
        // per workspace. Visible demand never waits for this background budget.
        const delay = Math.max(0, 60_000 - (Date.now() - background.current.lastWarm));
        if (delay) timer = window.setTimeout(schedule, delay);
        else schedule();
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (idle !== undefined) window.cancelIdleCallback(idle);
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [reads, enabled, visible, workspace]);
  return reads.request;
}
