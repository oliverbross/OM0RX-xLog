// @vitest-environment node
import { expect, it } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { ContestCallStack, emptyCallStack, restoreCallStack, type CallStackOperation, type CallStackPorts,
  type CallStackResult, type ParkedCallStackDraft } from "./contestCallStack";

it("real Host park → incoming commit → restart/resume preserves sent context and reservation with one-use replay", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "xlog-stack-host-"))), repo = resolve(".."), scope = {
    sessionID: randomUUID(), workspaceGeneration: randomUUID() };
  let process: ChildProcessWithoutNullStreams;
  let diagnostics = "";
  let waiters = new Map<string, { resolve(value: any): void; reject(error: unknown): void }>();
  const start = () => {
    process = spawn(globalThis.process.env.XLOG_TEST_PYTHON ?? "python3", ["-m", "contest_host", "--data-root", root],
      { cwd: repo, env: { ...globalThis.process.env, PYTHONPATH: join(repo, "python") } });
    process.stderr.on("data", data => { diagnostics += data.toString(); });
    createInterface({ input: process.stdout }).on("line", line => {
      const reply = JSON.parse(line), pending = waiters.get(reply.id); waiters.delete(reply.id);
      if (reply.ok) pending?.resolve(reply.result); else pending?.reject(reply.error);
    });
    process.on("exit", () => { for (const pending of waiters.values()) pending.reject(Error(`Host exited: ${diagnostics}`)); waiters.clear(); });
  };
  const stop = () => new Promise<void>(resolve => { if (process.exitCode !== null) { resolve(); return; }
    process.once("exit", () => resolve()); process.stdin.end(); });
  const call = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
    const id = randomUUID(); waiters.set(id, { resolve, reject });
    process.stdin.write(JSON.stringify({ id, method, params: { ...scope, ...params } }) + "\n");
  });
  let view: any, saved = "", loseReply = false;
  const draft = (): ParkedCallStackDraft => ({ ...scope, draftID: view.draftID, revision: view.revision,
    fields: Object.fromEntries(view.fields.map((f: any) => [f.id, f.value])),
    defaults: { callsign: "", sent: "599", receive: "599", other_1: String(view.reservedSerial).padStart(3, "0"), other_2: "" },
    receivedFieldIDs: ["receive", "other_2"], heardFieldIDs: ["receive", "other_2"],
    captureParkedSnapshot: true, reservedSerial: view.reservedSerial, allocatedSerialFieldID: "other_1" });
  const mutate = async (method: string, params: Record<string, unknown> = {}) => {
    const result = await call(method, { operationID: randomUUID(), expectedRevision: view?.revision ?? 0, ...params });
    view = result.projection; return result;
  };
  const operate = async (op: CallStackOperation): Promise<CallStackResult> => {
    const changed = await mutate(op.kind === "commit" ? "qso_commit" : "draft_apply", {
      operationID: op.operationID, expectedRevision: op.draft.revision, draftID: op.draft.draftID, fields: op.fields,
      ...(op.kind === "commit" ? { qsoID: op.operationID } : { manualStackLoad: true,
        stackTransition: op.stackTransition, stackCurrentFields: op.draft.fields }) });
    if (loseReply) { loseReply = false; throw Error("lost reply"); }
    return { operationID: op.operationID, draft: draft(), ...(op.kind === "commit" ? { qsoID: op.operationID } : {}) };
  };
  const ports: CallStackPorts = { getDraft: draft, mutate: operate, persist: s => { saved = JSON.stringify(s); },
    rejected: e => !!(e && typeof e === "object" && "outcome" in e && e.outcome === "rejected"),
    receipt: async op => { const receipt = await call("receipt", { operationID: op.operationID });
      if (!receipt.found) return null;
      view = receipt.result.projection;
      return { operationID: op.operationID, draft: draft(), ...(op.kind === "commit" ? { qsoID: op.operationID } : {}) }; } };
  start();
  try {
    await mutate("session_create", { pluginID: "cq_wpx_cw", station: { Call: "OM0RX", CQZone: "15", GridSquare: "JN88" },
      frequencyHz: 14025000, settings: { SentExchange: "#", OperatorCategory: "SINGLE-OP", BandCategory: "ALL", PowerCategory: "LOW" },
      reference: { id: "stack-fixture", countries: { OM0RX: { entity: "Slovak Republic", continent: "EU", cq: 15, itu: 28, primary_pfx: "OM" },
        K1ABC: { entity: "United States", continent: "NA", cq: 5, itu: 8, primary_pfx: "K" },
        DL1ABC: { entity: "Germany", continent: "EU", cq: 14, itu: 28, primary_pfx: "DL" } } } });
    await mutate("draft_apply", { fields: { callsign: "K1ABC", sent: "589", receive: "579", other_2: "007" } });
    const original = draft(), stack = new ContestCallStack(emptyCallStack(scope), ports);
    const incoming = stack.add("DL1ABC", { other_2: "008" }, ["other_2"]);
    loseReply = true; await expect(stack.load(incoming, "park")).rejects.toThrow("lost reply");
    const op = stack.snapshot().pending;
    expect(op?.phase).toBe("load");
    const recovered = new ContestCallStack(restoreCallStack(saved, scope), ports);
    await recovered.recover();
    expect(draft().draftID).not.toBe(original.draftID);
    expect(draft().reservedSerial).toBe(2);
    const outgoing = recovered.snapshot().items[0];
    // Replay the original mutation: no third reservation and no second effect.
    if (op?.phase === "load") await operate(op.operation);
    expect(draft().reservedSerial).toBe(2);
    await mutate("qso_commit", { qsoID: randomUUID(), fields: { callsign: "DL1ABC", other_2: "008" } });
    const queue = JSON.stringify(recovered.snapshot());
    await stop(); start(); view = (await call("session_open")).projection;
    const resumed = new ContestCallStack(restoreCallStack(queue, scope), ports);
    await resumed.load(outgoing.id, "discard");
    expect(draft().draftID).toBe(original.draftID);
    expect(draft().fields).toEqual(original.fields);
    expect(draft().reservedSerial).toBe(1);
    await mutate("qso_commit", { qsoID: randomUUID() });
    const rows = (await call("log")).rows;
    expect(rows).toHaveLength(2);
    expect(rows.find((r: any) => r.Call === "K1ABC")).toMatchObject({ SNT: "589", RCV: "579", SentNr: 1, NR: 7 });
    expect(rows.find((r: any) => r.Call === "DL1ABC").SentNr).toBe(2);
    expect(view.reservedSerial).toBe(4); // 3 was the post-incoming draft; resume itself allocates none.
    const before = draft();
    const stale = new ContestCallStack(restoreCallStack(queue, scope), ports);
    await expect(stale.load(outgoing.id, "discard")).rejects.toMatchObject({ code: "parked_draft_unavailable" });
    expect(draft()).toEqual(before);
    expect(stale.snapshot().items).toHaveLength(1);
  } finally { await stop(); }
}, 20000);
