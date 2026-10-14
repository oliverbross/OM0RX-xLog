// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncMutationClient } from "./syncMutation";
const owner = { generation: "workspace-one", revision: 2, context: "reviewed-context" };
const receipt = (intent: any, status = "acknowledged") => ({ operation_id: intent.operation_id.toUpperCase(), status,
  request: { method: intent.method, params: intent.params, owner: intent.owner } });
afterEach(() => localStorage.clear());

describe("shared native Sync mutation client", () => {
  it("persists exact reviewed intent before dispatch and clears only an exact receipt", async () => {
    const client = new SyncMutationClient("sync-test");
    const request = vi.fn(async (method, intent) => {
      expect(method).toBe("sync_mutation");
      expect(client.pending()).toEqual(intent);
      return receipt(intent);
    });
    await client.submit(request, owner, "sync_run", { confirm_single_writer: true });
    expect(request).toHaveBeenCalledOnce(); expect(client.pending()).toBeNull();
  });
  it("recovers lost acknowledgements after remount through receipt reads without replay", async () => {
    const client = new SyncMutationClient("sync-test");
    await expect(client.submit(async () => { throw Error("lost reply"); }, owner, "sync_retry", { id: "contact" })).rejects.toThrow("lost reply");
    const intent = client.pending()!;
    const reopened = new SyncMutationClient("sync-test");
    const read = vi.fn(async method => { expect(method).toBe("sync_receipt"); return { receipt: receipt(intent) }; });
    await reopened.recover(read); expect(read).toHaveBeenCalledOnce(); expect(reopened.pending()).toBeNull();
  });
  it.each(["unknown", "pending", "foreign", "missing"])("retains %s receipts and never guesses a replay", async status => {
    const client = new SyncMutationClient("sync-test");
    await expect(client.submit(async (_, intent) => status === "missing" ? {} : status === "foreign"
      ? { ...receipt(intent), request: { ...receipt(intent).request, params: {} } } : receipt(intent, status), owner, "sync_retry", { id: "contact" })).rejects.toThrow(/unknown/);
    const request = vi.fn(async (_method: string) => ({ receipt: null }));
    await expect(client.recover(request)).rejects.toThrow(/unknown/);
    await expect(client.submit(request, owner, "sync_run", {})).rejects.toThrow(/unresolved/);
    expect(request.mock.calls.map(call => call[0])).toEqual(["sync_receipt"]);
    expect(client.pending()).not.toBeNull(); client.discard(); expect(client.pending()).toBeNull();
  });
  it("does not dispatch when durable renderer intent cannot be saved or ownership is absent", async () => {
    const storage = { getItem: () => null, setItem: () => { throw Error("storage blocked"); } } as unknown as Storage;
    const request = vi.fn();
    await expect(new SyncMutationClient("key", storage).submit(request, owner, "sync_run", {})).rejects.toThrow("storage blocked");
    await expect(new SyncMutationClient("key").submit(request, {} as any, "sync_run", {})).rejects.toThrow(/unavailable/);
    expect(request).not.toHaveBeenCalled();
  });
});
