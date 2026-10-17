import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ContestClient, normalizedARRLDXPower, validateCreateInput } from "./client";
import { isStructuredEntry } from "./types";
import type { ContestCreateInput, ContestDraftFields, ContestExportPrepareRequest, ContestFullQSO, ContestRequest } from "./types";

const fixture = JSON.parse(readFileSync(new URL("../../../docs/contesting/fixtures/arrl-dx-worker-wire.json", import.meta.url), "utf8")) as any;
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

describe("generated ARRL DX worker wire", () => {
  it("pins both exact rules in the 16-row catalog", async () => {
    const catalog = await new ContestClient(vi.fn(async () => fixture.catalog) as ContestRequest).catalog();
    expect(catalog.rules).toHaveLength(16);
    expect(catalog.rules.filter(rule => rule.identity.id.startsWith("arrl-dx-")).map(rule => rule.identity.id))
      .toEqual(["arrl-dx-cw", "arrl-dx-ssb"]);
    for (const rule of catalog.rules.filter(rule => rule.identity.id.startsWith("arrl-dx-"))) {
      expect(isStructuredEntry(rule.entry)).toBe(true);
      if (!isStructuredEntry(rule.entry)) throw new Error("Expected structured ARRL DX entry.");
      expect(rule.entry.stationFields).toEqual([{ id: "section", label: "Cabrillo section", role: "cabrilloLocation", required: true, maximumUTF8Bytes: 3 }]);
      expect(rule.entry.exchange.sentFields?.map(field => field.acceptedKinds)).toEqual([["subdivision"], ["power"]]);
    }
  });

  it("normalizes every documented bounded power form without changing raw input", () => {
    expect([["K", "1000"], ["1KW", "1000"], ["KILO", "1000"], ["100WATTS", "100"],
      ["001500W", "1500"], ["ATT", "100"], ["000", "1000"]].map(([raw, _]) => [raw, normalizedARRLDXPower(raw)]))
      .toEqual([["K", "1000"], ["1KW", "1000"], ["KILO", "1000"], ["100WATTS", "100"],
        ["001500W", "1500"], ["ATT", "100"], ["000", "1000"]]);
    for (const raw of ["", "0", "1501", "1.5K", "watts", "100WATTSX"]) expect(normalizedARRLDXPower(raw)).toBeNull();
  });

  it("strictly decodes all direction and mode lifecycles", async () => {
    for (const [key, life] of Object.entries(fixture.scenarios) as [string, any][]) {
      const client = clientFor([life.create, life.applyFirst, life.commitFirst, life.applySecond, life.commitSecond,
        life.openAfterRestart, life.get, life.correct, life.delete]);
      const created = await client.create(fixture.catalog.result.workspaceGeneration, payloadInput(life.create.request));
      expect(created.session.station.stationFields).toEqual({ section: key.endsWith("wve") ? "EB" : "DX" });
      const appliedFirst = await client.applyDraft(created.session, created.draft.draftID,
        life.applyFirst.request.payload.fields as ContestDraftFields);
      const first = await client.commitQSO(appliedFirst.session, appliedFirst.draft.draftID);
      const appliedSecond = await client.applyDraft(first.session, first.draft.draftID,
        life.applySecond.request.payload.fields as ContestDraftFields);
      const second = await client.commitQSO(appliedSecond.session, appliedSecond.draft.draftID);
      const reopened = await client.open(second.session.sessionID, second.session.workspaceGeneration);
      const got = await client.qso(reopened.session, first.qso.qsoID);
      expect(got.qso.sentExchange).toBe(life.create.request.payload.station.exchangeFields.power || life.create.request.payload.station.exchangeFields.location);
      if (key.endsWith("dx")) expect(got.qso.normalizedSentExchange).toBe("1000");
      const correction = life.correct.request.payload as { qso: Omit<ContestFullQSO, "entity">; reason: string };
      const corrected = await client.correctQSO(reopened.session, { ...correction.qso, entity: got.qso.entity }, correction.reason);
      expect(corrected.currentTarget?.sentExchange).toBe(got.qso.sentExchange);
      const deletion = life.delete.request.payload as { qsoID: string; reason: string };
      expect((await client.deleteQSO(corrected.session as never, deletion.qsoID, deletion.reason)).qsoCount).toBe(1);
      expect(life.forgedCorrection.response).toMatchObject({ ok: false, error: { outcome: "confirmed" } });
    }
  });

  it("decodes both export formats and preserves raw ADIF power while bounding Cabrillo", async () => {
    const life = fixture.scenarios["cw-wve"];
    for (const format of ["cabrillo", "adif"] as const) {
      const item = life.exports[format]; let reply = item.prepareResponse;
      const request = vi.fn(async (_method: string, params: Record<string, unknown>) => {
        expect(params).toEqual(reply === item.prepareResponse ? item.prepareRequest : item.readRequest);
        const current = reply; reply = item.readResponse; return current;
      }) as ContestRequest;
      const client = new ContestClient(request);
      await client.prepareExport(item.prepareRequest as ContestExportPrepareRequest);
      const chunk = await client.readExport(item.readRequest);
      const document = new TextDecoder().decode(Uint8Array.from(atob(chunk.dataBase64), character => character.charCodeAt(0)));
      expect(document).toContain(format === "cabrillo" ? "CONTEST: ARRL-DX-CW" : "<CONTEST_ID:10>ARRL-DX-CW");
      expect(document).toContain(format === "cabrillo" ? "100" : "100WATTS");
    }
  });

  it("rejects crossed or noncanonical station fields before mutation", () => {
    const base = payloadInput(fixture.scenarios["cw-wve"].create.request);
    expect(() => validateCreateInput({ ...base, station: { ...base.station,
      exchangeFields: { location: "CA", power: "K" } } })).toThrow("invalid or oversized field");
    expect(() => validateCreateInput({ ...base, station: { ...base.station,
      exchangeFields: { location: "", power: "1kw" } } })).toThrow("invalid or oversized field");
    expect(() => validateCreateInput({ ...base, station: { ...base.station,
      stationFields: { section: "" } } })).toThrow("invalid or oversized field");
  });
});
