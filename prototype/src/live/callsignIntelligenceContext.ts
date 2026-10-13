import { normalizedCall } from "./draftEnrichment";
import { sameGeneration, validScopedSnapshot, type DraftSnapshot } from "./operatorDraftSession";
import type { IntelligenceRequest } from "./CallsignIntelligence";

export type CanonicalDraftState = { snapshot: DraftSnapshot | null; available: boolean; reading: boolean; error: string };
/** Read-only view. No edit session, journal, receipt replay or default workspace. */
export class CanonicalDraftFollower {
  private state: CanonicalDraftState = { snapshot: null, available: false, reading: false, error: "" };
  private listeners = new Set<() => void>();
  private active = false;
  private epoch = 0;
  private reading: Promise<boolean> | null = null;
  constructor(private read: () => Promise<any>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(value: Partial<CanonicalDraftState>) {
    this.state = { ...this.state, ...value }; this.listeners.forEach(listener => listener());
  }
  activate() { this.active = true; this.epoch++; this.update({ available: false, reading: false }); }
  dispose() { this.active = false; this.epoch++; this.reading = null; }
  refresh = (): Promise<boolean> => {
    if (!this.active) return Promise.resolve(false);
    if (this.reading) return this.reading;
    const epoch = this.epoch;
    this.update({ reading: true });
    const current = () => this.active && epoch === this.epoch;
    let work: Promise<boolean>;
    work = Promise.resolve().then(async () => {
      if (!current()) return false;
      try {
        const result = await this.read();
        if (!current()) return false;
        if (!validScopedSnapshot(result?.draft)) throw new Error("The shared new-QSO draft could not be verified. Refresh to retry.");
        const previous = this.state.snapshot;
        if (previous && sameGeneration(previous.generation, result.draft.generation) && result.draft.revision < previous.revision)
          throw new Error("The shared draft response is older than this view. Refresh to retry.");
        this.update({ snapshot: structuredClone(result.draft), available: true, error: "" });
        return true;
      } catch (cause) {
        if (!current()) return false;
        const error = cause instanceof Error ? cause : new Error("The shared new-QSO draft is unavailable. Refresh to retry.");
        this.update({ available: false, error: error.message }); throw error;
      }
    }).finally(() => {
      if (this.reading === work) { this.reading = null; if (current()) this.update({ reading: false }); }
    });
    this.reading = work; return work;
  };
}

export const intelligenceIdentity = (snapshot: DraftSnapshot | null) => snapshot
  ? JSON.stringify([snapshot.generation?.toLowerCase(), snapshot.qso.id.toLowerCase(), normalizedCall(snapshot.qso.call)]) : "";

/** Bounded, memory-only lookup cache. Credentials/client ownership stay native. */
export class CallsignLookupCache {
  private cache = new Map<string, { profile: Record<string, any>; until: number }>();
  private pending = new Map<string, Promise<Record<string, any>>>();
  constructor(private request: IntelligenceRequest, private now: () => number = Date.now) {}
  invalidate(key: string) { this.cache.delete(key); }
  lookup(key: string, call: string): Promise<Record<string, any>> {
    const cached = this.cache.get(key);
    if (cached && cached.until > this.now()) return Promise.resolve(structuredClone(cached.profile));
    const pending = this.pending.get(key); if (pending) return pending;
    let work: Promise<Record<string, any>>;
    work = Promise.resolve().then(async () => {
      const profile = await this.request("lookup_call", { call });
      if (!profile || typeof profile !== "object" || Array.isArray(profile) || normalizedCall(profile.call) !== call)
        throw new Error("The lookup response does not match the shared callsign.");
      this.cache.delete(key);
      this.cache.set(key, { profile: structuredClone(profile), until: this.now() + 300_000 });
      if (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!);
      return structuredClone(profile);
    }).finally(() => { if (this.pending.get(key) === work) this.pending.delete(key); });
    this.pending.set(key, work); return work;
  }
}
