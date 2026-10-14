type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<Data>;
export type SyncIntent = { operation_id: string; owner: Data; method: string; params: Data };
const canonical = (value: any): string => JSON.stringify(value && typeof value === "object"
  ? Array.isArray(value) ? value.map(item => JSON.parse(canonical(item)))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);

/** The renderer records intent, but only the native service admits/dispatches it.
 * Recovery only reads receipts. A missing or unknown receipt never resends intent. */
export class SyncMutationClient {
  constructor(private readonly key: string, private readonly suppliedStorage?: Storage) {}
  private get storage(): Storage { return this.suppliedStorage ?? localStorage; }
  pending(): SyncIntent | null {
    const raw = this.storage.getItem(this.key);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value.operation_id !== "string" || !value.owner || typeof value.owner.generation !== "string"
      || !["sync_run", "sync_configure", "sync_retry", "sync_resolve"].includes(value.method) || !value.params)
      throw new Error("Saved Sync intent is unreadable. Review the current state before dismissing it.");
    return value;
  }
  private accept(intent: SyncIntent, receipt: Data | null) {
    if (!receipt || typeof receipt.operation_id !== "string" || !receipt.request || typeof receipt.request !== "object"
      || receipt.operation_id.toLowerCase() !== intent.operation_id.toLowerCase()
      || canonical(receipt.request) !== canonical({ owner: intent.owner, method: intent.method, params: intent.params }))
      throw new Error("Sync outcome is unknown. Refresh to inspect its receipt; the operation will not be replayed.");
    if (receipt.status !== "acknowledged")
      throw new Error("Sync outcome is unknown. Review the refreshed state before dismissing this intent; it will not be replayed.");
    this.storage.removeItem(this.key);
  }
  async recover(request: Request): Promise<void> {
    const intent = this.pending();
    if (!intent) return;
    const result = await request("sync_receipt", { generation: intent.owner.generation, operation_id: intent.operation_id });
    this.accept(intent, result.receipt);
  }
  async submit(request: Request, owner: Data, method: string, params: Data): Promise<void> {
    if (this.pending()) throw new Error("Review the unresolved Sync operation before another action.");
    if (!owner || typeof owner.generation !== "string" || !Number.isSafeInteger(owner.revision) || typeof owner.context !== "string")
      throw new Error("Sync ownership is unavailable. Refresh before another action.");
    const intent = { operation_id: crypto.randomUUID(), owner, method, params };
    const serialized = JSON.stringify(intent);
    this.storage.setItem(this.key, serialized);
    if (this.storage.getItem(this.key) !== serialized) throw new Error("Sync intent could not be saved. No operation was dispatched.");
    this.accept(intent, await request("sync_mutation", intent));
  }
  discard(): void { this.storage.removeItem(this.key); }
}
