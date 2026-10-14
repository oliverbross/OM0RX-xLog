import { describe, expect, it, vi } from "vitest";
import { SharedCWSession, type CWTransport } from "./sharedCWSession";
import { defaultCWProfile } from "./cwMacros";
const snapshot = (client: string, revision = 1) => ({ revision, armed: false, pending: false, owner: null, lease: "lease", client,
  message: "CW disarmed", error: "", winkeyer: null, canonical: { profile: defaultCWProfile, context: { CALL: "K1ABC" }, provider: "direct_agent" } });
describe("native shared CW renderer adapter", () => {
  it("sends only saved macro identity and revisions, never renderer text/context", async () => {
    const transport = vi.fn<CWTransport>(async client => ({ ...snapshot(client), armed: true }));
    const session = new SharedCWSession(transport); await session.refresh();
    await session.send({ ...defaultCWProfile.macros[0], text: "UNSAVED" }, { CALL: "HISTORICAL" });
    expect(transport.mock.calls[1][2]).toEqual({ action: "send", expectedRevision: 1, lease: "lease", macroID: 1 });
    expect(transport.mock.calls.map(call => call[1])).toEqual([1, 2]);
  });
  it("a second client cannot use the first client's armed snapshot", async () => {
    const transport = vi.fn<CWTransport>(async () => ({ ...snapshot("other"), armed: true }));
    const session = new SharedCWSession(transport); await session.refresh(); expect(session.getSnapshot().armed).toBe(false);
  });
  it("ignores a late stale snapshot after a newer Stop reply", async () => {
    let resolve!: (value: any) => void;
    const transport = vi.fn<CWTransport>().mockImplementationOnce(() => new Promise(yes => { resolve = yes; }))
      .mockImplementation(async client => snapshot(client, 3));
    const session = new SharedCWSession(transport); const pending = session.refresh(); await session.stop();
    resolve({ ...snapshot(session.client, 2), armed: true }); await pending;
    expect(session.getSnapshot()).toMatchObject({ revision: 3, armed: false });
  });
  it("lost send acknowledgement stays disarmed across polling and never retries text", async () => {
    const transport = vi.fn<CWTransport>(async (client, _, params) => {
      if (params.action === "send") throw new Error("IPC reply lost"); return { ...snapshot(client), armed: true };
    });
    const session = new SharedCWSession(transport); await session.refresh(); await session.send(defaultCWProfile.macros[0]); await session.refresh();
    expect(session.getSnapshot().armed).toBe(false); expect(session.getSnapshot().error).toMatch(/lost/);
    expect(transport.mock.calls.filter(call => call[2].action === "send")).toHaveLength(1);
  });
  it("lost Arm acknowledgement requests Stop and cleanup unregisters without replay", async () => {
    const transport = vi.fn<CWTransport>(async (client, _, params) => {
      if (params.action === "arm") throw new Error("IPC reply lost"); return snapshot(client);
    });
    const session = new SharedCWSession(transport); await session.refresh(); await session.arm(); session.dispose(); await Promise.resolve();
    expect(transport.mock.calls.map(call => call[2].action)).toEqual(["snapshot", "arm", "stop", "unregister"]);
  });
});
