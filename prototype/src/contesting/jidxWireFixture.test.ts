import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ContestClient, validateCreateInput } from "./client";
import type { ContestCreateInput, ContestDraftFields, ContestExportPrepareRequest, ContestFullQSO, ContestRequest } from "./types";

const fixture = JSON.parse(readFileSync(new URL("../../../docs/contesting/fixtures/jidx-worker-wire.json", import.meta.url), "utf8")) as any;
const payloadInput = (request: any) => {
  const { sessionID: _sessionID, ...input } = request.payload as ContestCreateInput & { sessionID: string };
  return input;
};
function clientFor(items: { request: any; response: any }[]) {
  const queue = [...items], ids = items.flatMap(item => item.request.expectedRevision === 0
    ? [item.request.sessionID, item.request.requestID] : item.request.requestID ? [item.request.requestID] : []);
  const digests = items.filter(item => item.request.payloadDigest).map(item => item.request.payloadDigest);
  const times = items.filter(item => item.request.operationTimestamp).map(item => item.request.operationTimestamp);
  const request = vi.fn(async (_method: string, params: Record<string, unknown>) => {
    const next = queue.shift()!; expect(params).toEqual(next.request); return next.response;
  }) as ContestRequest;
  return new ContestClient(request, () => ids.shift()!, async () => digests.shift()!, undefined, () => times.shift()!);
}

describe("generated JIDX worker wire", () => {
  it("pins the 14-row catalog while preserving legacy v1 shapes", async () => {
    const catalog = await new ContestClient(vi.fn(async () => fixture.catalog) as ContestRequest).catalog();
    expect(catalog.rules).toHaveLength(14);
    const legacy = catalog.rules.filter(rule => rule.entryDescriptorVersion === 1);
    expect(legacy).toHaveLength(8);
    expect(legacy.every(rule => !("version" in rule.entry))).toBe(true);
    expect(catalog.rules.filter(rule => rule.identity.id.startsWith("jidx-")).map(rule => rule.identity.id)).toEqual(["jidx-cw", "jidx-ssb"]);
  });

  it("accepts JA, DX, and entityless MM create frames with raw and normalized authority intact", async () => {
    for (const side of ["dx", "ja", "mm"] as const) {
      const item = fixture.creates[side], client = clientFor([item]);
      const created = await client.create(fixture.catalog.result.workspaceGeneration, payloadInput(item.request));
      expect(created.session.rule.identity.id).toMatch(/^jidx-/);
      if (side === "mm") {
        expect(created.session.station).toMatchObject({ callsign: "OM0RX/MM", cqZone: "03", dxccEntity: "", exchangeFields: { number: "3" } });
        expect(created.draft.fields.sentExchange).toBe("3");
      }
    }
  });

  it("round-trips raw single-digit evidence through sequential returned drafts and correction", async () => {
    const mm = fixture.creates.mm, life = fixture.singleDigitLifecycle;
    const client = clientFor([mm, life.applyFirst, life.commitFirst, life.applySecond, life.commitSecond,
      life.openAfterRestart, life.get, life.correct]);
    const created = await client.create(fixture.catalog.result.workspaceGeneration, payloadInput(mm.request));
    const firstFields = { ...created.draft.fields, callsign: "JA1AAA", receivedExchange: "3",
      receivedExchangeFields: { number: "3" }, frequencyHz: 14_025_000 } as ContestDraftFields;
    const appliedFirst = await client.applyDraft(created.session, created.draft.draftID, firstFields);
    const committedFirst = await client.commitQSO(appliedFirst.session, appliedFirst.draft.draftID);
    expect(committedFirst.qso).toMatchObject({ sentExchange: "3", receivedExchange: "3" });
    const secondFields = { ...committedFirst.draft.fields, callsign: "JA1BBB", receivedExchange: "4",
      receivedExchangeFields: { number: "4" }, frequencyHz: 14_026_000 } as ContestDraftFields;
    const appliedSecond = await client.applyDraft(committedFirst.session, committedFirst.draft.draftID, secondFields);
    const committedSecond = await client.commitQSO(appliedSecond.session, appliedSecond.draft.draftID);
    expect(committedSecond.draft.fields).toMatchObject({ sentExchange: "3", sentExchangeFields: { number: "3" } });
    const opened = await client.open(committedSecond.session.sessionID, committedSecond.session.workspaceGeneration);
    const got = await client.qso(opened.session, committedSecond.qso.qsoID);
    expect(got.qso).toMatchObject({ sentExchange: "3", normalizedSentExchange: "03",
      receivedExchange: "4", normalizedReceivedExchange: "04",
      sentExchangeFields: { number: "3" }, receivedExchangeFields: { number: "4" } });
    const correction = life.correct.request.payload as { qso: Omit<ContestFullQSO, "entity">; reason: string };
    const corrected = await client.correctQSO(opened.session, { ...correction.qso, entity: got.qso.entity }, correction.reason);
    expect(corrected.currentTarget).toMatchObject({ sentExchange: "3", normalizedSentExchange: "03",
      receivedExchange: "5", normalizedReceivedExchange: "05",
      sentExchangeFields: { number: "3" }, receivedExchangeFields: { number: "5" } });
  });

  it("decodes apply, commit, restart, edit, delete, and both export documents", async () => {
    const dx = fixture.creates.dx, life = fixture.lifecycle;
    const client = clientFor([dx, life.apply, life.commit, life.openAfterRestart, life.get, life.correct, life.delete]);
    const created = await client.create(fixture.catalog.result.workspaceGeneration, payloadInput(dx.request));
    const applied = await client.applyDraft(created.session, created.draft.draftID,
      life.apply.request.payload.fields as ContestDraftFields);
    const committed = await client.commitQSO(applied.session, applied.draft.draftID);
    expect(committed.score).toMatchObject({ points: 1, multipliers: 1, claimedScore: 1 });
    const opened = await client.open(committed.session.sessionID, committed.session.workspaceGeneration);
    const got = await client.qso(opened.session, committed.qso.qsoID);
    const correction = life.correct.request.payload as { qso: Omit<ContestFullQSO, "entity">; reason: string };
    const corrected = await client.correctQSO(opened.session, { ...correction.qso, entity: got.qso.entity }, correction.reason);
    expect(corrected.currentTarget?.receivedExchangeFields).toEqual({ number: "14" });
    const deletion = life.delete.request.payload as { qsoID: string; reason: string };
    expect((await client.deleteQSO(corrected.session as never, deletion.qsoID, deletion.reason)).qsoCount).toBe(0);

    for (const format of ["cabrillo", "adif"] as const) {
      const item = fixture.exports[format]; let reply = item.prepareResponse;
      const request = vi.fn(async (_method: string, params: Record<string, unknown>) => {
        expect(params).toEqual(reply === item.prepareResponse ? item.prepareRequest : item.readRequest);
        const current = reply; reply = item.readResponse; return current;
      }) as ContestRequest;
      const exportClient = new ContestClient(request);
      await exportClient.prepareExport(item.prepareRequest as ContestExportPrepareRequest);
      const chunk = await exportClient.readExport(item.readRequest);
      const document = new TextDecoder().decode(Uint8Array.from(atob(chunk.dataBase64), c => c.charCodeAt(0)));
      expect(document).toContain(format === "cabrillo" ? "CONTEST: JIDX-CW" : "<CONTEST_ID:7>JIDX-CW");
    }
    for (const format of ["cabrillo", "adif"] as const) {
      const item = fixture.singleDigitExports[format]; let reply = item.prepareResponse;
      const request = vi.fn(async (_method: string, params: Record<string, unknown>) => {
        expect(params).toEqual(reply === item.prepareResponse ? item.prepareRequest : item.readRequest);
        const current = reply; reply = item.readResponse; return current;
      }) as ContestRequest;
      const exportClient = new ContestClient(request);
      await exportClient.prepareExport(item.prepareRequest as ContestExportPrepareRequest);
      const chunk = await exportClient.readExport(item.readRequest);
      const document = new TextDecoder().decode(Uint8Array.from(atob(chunk.dataBase64), c => c.charCodeAt(0)));
      expect(document).toContain(format === "cabrillo" ? "SENTNR: 03" : "<STX_STRING:1>3");
      expect(document).toContain(format === "cabrillo" ? "JA1AAA        599 03" : "<SRX_STRING:1>3");
      expect(document).toContain(format === "cabrillo" ? "JA1BBB        599 05" : "<SRX_STRING:1>5");
    }
  });

  it("rejects crossed descriptor and maritime authority frames", async () => {
    const base = payloadInput(fixture.creates.mm.request);
    expect(() => validateCreateInput({ ...base, station: { callsign: "MM/F1ABC", cqZone: "14", dxccEntity: "SCOTLAND",
      exchangeFields: { number: "14" } } })).not.toThrow();
    expect(() => validateCreateInput({ ...base, station: { callsign: "MM/F1ABC/MM", cqZone: "14", dxccEntity: "",
      exchangeFields: { number: "14" } } })).not.toThrow();
    for (const callsign of ["K1AAA/MM/P", "K1AAA/MM/MM", "MM/1/MM", "MM/F1ABC/AM"]) {
      expect(() => validateCreateInput({ ...base, station: { callsign, cqZone: "14", dxccEntity: "",
        exchangeFields: { number: "14" } } })).toThrow("invalid or oversized field");
    }
    const badCatalog = structuredClone(fixture.catalog);
    badCatalog.result.rules.find((rule: any) => rule.identity.id === "jidx-cw").entry.exchange.sentFields[0].acceptedKinds = ["serialNumber"];
    await expect(new ContestClient(vi.fn(async () => badCatalog) as ContestRequest).catalog()).rejects.toThrow("Malformed or stale contest_catalog response");
    for (const mutate of [
      (frame: any) => { frame.result.session.station.dxccEntity = "SLOVAK REPUBLIC"; },
      (frame: any) => { frame.result.session.station.cqZone = "15"; },
      (frame: any) => { frame.result.session.station.callsign = "1/MM"; },
    ]) {
      const response = structuredClone(fixture.creates.mm.response); mutate(response);
      const client = clientFor([{ request: fixture.creates.mm.request, response }]);
      await expect(client.create(fixture.catalog.result.workspaceGeneration, payloadInput(fixture.creates.mm.request)))
        .rejects.toMatchObject({ name: "ContestMutationUncertain" });
    }
    expect(fixture.rejectedCreates).toMatchObject({ "JIDX land nil": { ok: false }, "JIDX MM entity": { ok: false },
      "JIDX crossed MM": { ok: false }, "JIDX malformed": { ok: false } });
    expect(fixture.unsupportedExport.response).toMatchObject({ ok: false, error: { code: "unsupported_category", outcome: "confirmed" } });
  });
});
