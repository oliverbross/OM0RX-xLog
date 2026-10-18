import { describe, expect, it, vi } from "vitest";
import { canonicalJSON, ContestClient, ContestMutationUncertain, ContestServerError, validateCreateInput, validateDraftFields } from "./client";
import type { HistorySelection } from "./contestCallHistory";
import type { ContestDraftFields, ContestFullQSO, ContestOperatorCapability, ContestRequest, ContestRuleMetadata, ContestScoreSummary, ContestSessionSummary } from "./types";

const capability: ContestOperatorCapability = { version: 1, auditDigest: "f068c4cf73ab0b9ec9f77a43c75e6deaca9a11da946fd9c8216b41c925f6cc4e", policy: "simulated-run-sp-v1",
  output: "simulation-only", styles: ["run", "search-and-pounce"],
  macros: ["CQ", "EXCH", "QRZ", "AGN", "HISCALL", "MYCALL", "QSOB4"] };
const rule: ContestRuleMetadata = { identity: { id: "cq-ww-cw", version: "1.0.0-source-spike", edition: "source-26.10.11", sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" }, displayName: "CQ WW CW", mode: "CW", entryDescriptorVersion: 1,
  entry: { mode: "CW", adifMode: "CW", cabrilloQSOType: "CW", cabrilloFormatterVersion: "pilot-1", cabrilloProjectionFormatterVersion: "pilot-2",
    report: { format: "cwRST", defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3 },
    exchange: { sent: "cqZone", received: "cqZone", sentDefault: "stationSnapshot", adifFields: "none" }, serial: { requirement: "none", allowedScopes: [] } },
  referenceDataVersion: "cty-2026.10", sourceVerification: "verified", sourceNote: "Checked", operatorCapability: capability };
const declarativeDigest = "a".repeat(64);
const declarativeRule: ContestRuleMetadata = { identity: { id: "ten-ten-fall-phone", version: "1.0.0", edition: "source-compatible", sourceRevision: declarativeDigest },
  displayName: "10-10 Fall Phone", mode: "SSB", entryDescriptorVersion: 2, supportedBands: ["10m"], supportedModes: ["SSB", "AM", "FM"],
  entry: { version: 2, mode: "SSB", adifMode: "SSB", cabrilloQSOType: "PH", cabrilloFormatterVersion: "declarative-archive-1",
    cabrilloProjectionFormatterVersion: "declarative-archive-1", report: { format: "none", defaultSent: "", defaultReceived: "", maximumUTF8Bytes: 0 },
    exchange: { sent: "structured", received: "structured", sentDefault: "stationFields", adifFields: "exchangeStrings",
      sentFields: [{ id: "member", label: "10-10 number", acceptedKinds: ["nonnegativeInteger"], required: true, maximumUTF8Bytes: 8, adifField: "STX" },
        { id: "qth", label: "QTH", acceptedKinds: ["locationText"], required: true, maximumUTF8Bytes: 32, adifField: "MY_STATE" }],
      receivedFields: [{ id: "member", label: "10-10 number", acceptedKinds: ["nonnegativeInteger"], required: true, maximumUTF8Bytes: 8, adifField: "SRX" },
        { id: "qth", label: "QTH", acceptedKinds: ["locationText"], required: true, maximumUTF8Bytes: 32, adifField: "STATE" }] },
    serial: { requirement: "none", allowedScopes: [] }, modeProfiles: ["SSB", "AM", "FM"].map(mode => ({ mode: mode as "SSB" | "AM" | "FM", adifMode: mode as "SSB" | "AM" | "FM", adifSubmode: null, cabrilloQSOType: "PH" as const,
      report: { format: "none" as const, defaultSent: "", defaultReceived: "", maximumUTF8Bytes: 0 } })), scorePolicy: "pointsOnly" },
  referenceDataVersion: "cty-2026.10", sourceVerification: "provisional", sourceNote: "Immutable operator archive",
  declarativeDefinition: { definitionDigest: declarativeDigest, immutablePerSession: true, exportPurpose: "operatorArchive", submissionReady: false } };
const session: ContestSessionSummary = { sessionID: "session-1", workspaceGeneration: "generation-1", revision: 7, name: "WW", rule, referenceDataVersion: rule.referenceDataVersion, station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "Slovak Republic" }, operator: { callsign: "OM0RX", category: "Single Operator" }, qsoCount: 0, updatedAt: "2026-10-17T00:00:00Z" };
const fields: ContestDraftFields = { callsign: "K1ABC", sentReport: "599", sentExchange: "15", receivedReport: "599", receivedExchange: "05", frequencyHz: 14025000, band: "20m", mode: "CW" };
function draft(revision = 8) { return { draftID: "draft-1", sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision, fields, reservedSerial: null, validation: { errors: [], warnings: [] }, dupe: { state: "clear" as const, reason: "Clear" },
  operatorReadiness: { capabilityDigest: capability.auditDigest, callsign: "ready" as const, exchange: "ready" as const, canSendCQ: false,
    canSendCall: true, canSendDuplicate: false, canReserveCall: false, canReserveCommit: false, canCommit: true }, updatedAt: "2026-10-17T00:00:01Z" }; }
function result(params: Record<string, unknown>) { const next = { ...session, revision: 8 }; return { session: next, draft: draft(), receipt: { requestID: params.requestID, payloadDigest: params.payloadDigest, committedRevision: 8, committedAt: "2026-10-17T00:00:01Z" } }; }
function ssbSession(): ContestSessionSummary {
  return { ...session, rule: { ...rule, identity: { ...rule.identity, id: "cq-ww-ssb" }, displayName: "CQ WW SSB", mode: "SSB",
    operatorCapability: { ...capability, auditDigest: "88c2ec26c9f9df6d5d54d000c38441ceb2a61be583d0529e658b76f2028f760e" },
    entry: { ...rule.entry, mode: "SSB", adifMode: "SSB", cabrilloQSOType: "PH", cabrilloFormatterVersion: "ssb-pilot-1",
      cabrilloProjectionFormatterVersion: "ssb-pilot-2", report: { format: "phoneRS", defaultSent: "59", defaultReceived: "59", maximumUTF8Bytes: 2 } } } };
}

describe("ContestClient", () => {
  it("validates declarative QSO reads, corrections, and deletions against each session descriptor", async () => {
    const field = (id: string, kinds: string[], maximumUTF8Bytes = 32) => ({ id, label: id, acceptedKinds: kinds,
      required: true, maximumUTF8Bytes, adifField: null });
    const variant = (id: string, sentFields: ReturnType<typeof field>[], receivedFields: ReturnType<typeof field>[], serial: boolean): ContestRuleMetadata => {
      const value = structuredClone(declarativeRule) as any;
      value.identity = { id, version: "1.0.0", edition: "archive", sourceRevision: declarativeDigest };
      value.displayName = id; value.mode = "CW"; value.supportedBands = ["40m"]; value.supportedModes = ["CW"];
      value.entry = { ...value.entry, mode: "CW", adifMode: "CW", cabrilloQSOType: "CW",
        report: { format: "none", defaultSent: "", defaultReceived: "", maximumUTF8Bytes: 0 },
        exchange: { ...value.entry.exchange, sentFields, receivedFields },
        serial: serial ? { requirement: "requiredForCommit", allowedScopes: ["session"] } : { requirement: "none", allowedScopes: [] },
        modeProfiles: [{ mode: "CW", adifMode: "CW", adifSubmode: null, cabrilloQSOType: "CW",
          report: { format: "none", defaultSent: "", defaultReceived: "", maximumUTF8Bytes: 0 } }] };
      return value;
    };
    const cases = [
      { rule: declarativeRule, band: "10m", mode: "AM", sent: { member: "0", qth: "NEW ZEALAND" },
        received: { member: "123", qth: "NEW YORK" }, sentAggregate: "0 NEW ZEALAND", receivedAggregate: "123 NEW YORK" },
      { rule: variant("cwt", [field("name", ["operatorName"]), field("member-or-location", ["nonnegativeInteger", "locationText"])],
          [field("name", ["operatorName"]), field("member-or-location", ["nonnegativeInteger", "locationText"])], false),
        band: "40m", mode: "CW", sent: { name: "OLIVER", "member-or-location": "NT" },
        received: { name: "AL", "member-or-location": "123" }, sentAggregate: "OLIVER NT", receivedAggregate: "AL 123" },
      { rule: variant("cw-open", [field("serial", ["serialNumber"], 8), field("name", ["operatorName"])],
          [field("serial", ["serialNumber"], 8), field("name", ["operatorName"])], true),
        band: "40m", mode: "CW", sent: { serial: "001", name: "OLIVER" }, received: { serial: "042", name: "AL" },
        sentAggregate: "001 OLIVER", receivedAggregate: "042 AL" },
      { rule: variant("icwc-mst", [field("name", ["operatorName"]), field("serial", ["serialNumber"], 8)],
          [field("name", ["operatorName"]), field("serial", ["serialNumber"], 8)], true),
        band: "40m", mode: "CW", sent: { name: "OLIVER", serial: "001" }, received: { name: "AL", serial: "042" },
        sentAggregate: "OLIVER 001", receivedAggregate: "AL 042" },
    ] as const;
    for (const [index, item] of cases.entries()) {
      const activeSession: ContestSessionSummary = { ...session, sessionID: `declarative-${index}`, revision: 7, rule: item.rule,
        referenceDataVersion: item.rule.referenceDataVersion, station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "Slovakia",
          exchangeFields: item.sent }, qsoCount: 1 };
      const qso: ContestFullQSO = { qsoID: `qso-${index}`, sessionID: activeSession.sessionID, originalUTC: "2026-10-18T01:02:03.000Z",
        callsign: "K1ABC", band: item.band, mode: item.mode, frequencyHz: item.band === "10m" ? 28_400_000 : 7_030_000,
        sentReport: "", receivedReport: "", sentExchange: item.sentAggregate, normalizedSentExchange: item.sentAggregate,
        allocatedSerial: item.sentAggregate, receivedExchange: item.receivedAggregate, normalizedReceivedExchange: item.receivedAggregate,
        entity: { adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5 }, operatorCallsign: "OM0RX",
        stationLocation: "Home", provenance: { source: "operatorEntry", sourceIdentity: "cty-2026.10", importedClaimedScore: null },
        ruleIdentity: item.rule.identity, referenceDataVersion: item.rule.referenceDataVersion,
        sentExchangeFields: item.sent, receivedExchangeFields: item.received };
      let revision = 7;
      const request = vi.fn(async (method: string, params: Record<string, any>) => {
        if (method === "contest_qso_get") return { id: "frame", ok: true as const,
          result: { sessionID: activeSession.sessionID, workspaceGeneration: activeSession.workspaceGeneration, revision, qso } };
        revision += 1;
        const changeSession = { sessionID: activeSession.sessionID, workspaceGeneration: activeSession.workspaceGeneration, revision,
          name: activeSession.name, ruleIdentity: item.rule.identity, referenceDataVersion: item.rule.referenceDataVersion,
          qsoCount: method === "contest_qso_delete" ? 0 : 1, updatedAt: "2026-10-18T01:03:00.000Z" };
        const result = { session: changeSession, operation: method === "contest_qso_correct" ? "correction" : "deletion",
          qsoID: qso.qsoID, qsoCount: changeSession.qsoCount,
          score: { sessionID: activeSession.sessionID, workspaceGeneration: activeSession.workspaceGeneration, revision,
            qsos: changeSession.qsoCount, points: changeSession.qsoCount, multipliers: 0, claimedScore: changeSession.qsoCount,
            sourceVerification: "provisional" }, currentTarget: method === "contest_qso_correct" ? qso : null,
          auditReference: { sessionID: activeSession.sessionID, qsoID: qso.qsoID, requestID: params.requestID, revision },
          receipt: { requestID: params.requestID, payloadDigest: params.payloadDigest, committedRevision: revision,
            committedAt: "2026-10-18T01:03:00.000Z" } };
        return { id: "frame", ok: true as const, result };
      }) as ContestRequest;
      const ids = [`correct-${index}`, `delete-${index}`];
      const client = new ContestClient(request, () => ids.shift()!, async () => `digest-${index}`,
        undefined, () => "2026-10-18T01:03:00.000Z");
      await expect(client.qso(activeSession, qso.qsoID)).resolves.toMatchObject({ qso: { sentExchangeFields: item.sent } });
      const corrected = await client.correctQSO(activeSession, qso, "Correct reviewed contact");
      expect(corrected.currentTarget?.receivedExchangeFields).toEqual(item.received);
      await expect(client.deleteQSO({ ...activeSession, revision: 8 }, qso.qsoID, "Delete reviewed contact"))
        .resolves.toMatchObject({ operation: "deletion", currentTarget: null, qsoCount: 0 });
    }
  });

  it("rejects a scalar QSO whose allocated serial differs from its normalized sent exchange", async () => {
    const qso: ContestFullQSO = { qsoID: "scalar-qso", sessionID: session.sessionID, originalUTC: "2026-10-18T01:02:03.000Z",
      callsign: "K1ABC", band: "20m", mode: "CW", frequencyHz: 14_025_000, sentReport: "599", receivedReport: "599",
      sentExchange: "001", normalizedSentExchange: "001", allocatedSerial: "999", receivedExchange: "05",
      normalizedReceivedExchange: "05", entity: { adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5 },
      operatorCallsign: "OM0RX", stationLocation: "Home", provenance: { source: "operatorEntry", sourceIdentity: "cty-2026.10",
        importedClaimedScore: null }, ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion };
    const request = vi.fn(async () => ({ id: "frame", ok: true as const,
      result: { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: session.revision, qso } })) as ContestRequest;
    await expect(new ContestClient(request).qso(session, qso.qsoID)).rejects.toThrow("Malformed or stale contest_qso_get response");
  });

  it("admits a generic declarative catalog rule and pins its digest into creation", async () => {
    const catalogRequest = vi.fn(async () => ({ id: "frame", ok: true as const,
      result: { workspaceGeneration: "generation-1", rules: [declarativeRule] } })) as ContestRequest;
    await expect(new ContestClient(catalogRequest).catalog()).resolves.toEqual({ workspaceGeneration: "generation-1", rules: [declarativeRule] });
    const input = { name: "10-10", ruleIdentity: declarativeRule.identity, referenceDataVersion: declarativeRule.referenceDataVersion,
      definitionDigest: declarativeDigest, station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "Slovakia",
        exchangeFields: { member: "0", qth: "NEW ZEALAND" } }, operator: { callsign: "OM0RX", category: "Single Operator" } };
    expect(() => validateCreateInput(input, declarativeRule)).not.toThrow();
    expect(() => validateCreateInput({ ...input, definitionDigest: undefined }, declarativeRule)).toThrow("identity changed");
    const declarativeFields: ContestDraftFields = { callsign: "ZL1AAA", sentReport: "", sentExchange: "0 NEW ZEALAND",
      receivedReport: "", receivedExchange: "123 NEW ZEALAND", frequencyHz: 28_400_000, band: "10m", mode: "AM",
      sentExchangeFields: { member: "0", qth: "NEW ZEALAND" }, receivedExchangeFields: { member: "123", qth: "NEW ZEALAND" } };
    expect(() => validateDraftFields(declarativeFields, declarativeRule)).not.toThrow();
    expect(() => validateDraftFields({ ...declarativeFields, band: "20m" }, declarativeRule)).toThrow("selected rule");
    const request = vi.fn(async () => ({ id: "frame", ok: false as const,
      error: { code: "fixture_stop", message: "captured", outcome: "confirmed" as const } })) as ContestRequest;
    const ids = ["session-declarative", "request-declarative"];
    await expect(new ContestClient(request, () => ids.shift()!, async () => "digest").create("generation-1", input, declarativeRule))
      .rejects.toMatchObject({ code: "fixture_stop" });
    expect(request).toHaveBeenCalledWith("contest_create", expect.objectContaining({ payload: expect.objectContaining({
      definitionDigest: declarativeDigest, ruleIdentity: declarativeRule.identity,
    }) }));
  });

  it("keeps durable commit score summaries scalar", () => {
    const summary = { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: 8, qsos: 1, points: 3,
      multipliers: 1, claimedScore: 3, sourceVerification: "provisional" } satisfies ContestScoreSummary;
    expect(summary).not.toHaveProperty("multiplierLabels");
  });

  it("scopes receipt lookup and retries the exact structured operation", async () => {
    const mock = vi.fn().mockRejectedValueOnce(new Error("reply lost")).mockImplementationOnce(async (_method, params) => ({ id: "frame", ok: true, result: result(params) })).mockResolvedValueOnce({ id: "frame", ok: true, result: { status: "not_found" } });
    const client = new ContestClient(mock as ContestRequest, () => "request-1", async () => "digest-1");
    let uncertain!: ContestMutationUncertain;
    try { await client.applyDraft(session, "draft-1", fields); } catch (cause) { uncertain = cause as ContestMutationUncertain; }
    expect(uncertain).toBeInstanceOf(ContestMutationUncertain);
    await client.retry(uncertain.operation);
    expect(mock.mock.calls[1]).toEqual(mock.mock.calls[0]);
    await client.receipt(uncertain.operation);
    expect(mock).toHaveBeenLastCalledWith("contest_operation_receipt", { sessionID: "session-1", workspaceGeneration: "generation-1", requestID: "request-1", payloadDigest: "digest-1" });
  });

  it("keeps confirmed validation and stale revision failures editable", async () => {
    for (const code of ["invalid_exchange", "stale_revision"]) {
      const request = vi.fn(async () => ({ id: "frame", ok: false as const, error: { code, message: code, outcome: "confirmed" as const } })) as ContestRequest;
      const client = new ContestClient(request, () => "request", async () => "digest");
      await expect(client.applyDraft(session, "draft-1", fields)).rejects.toMatchObject({ name: "ContestServerError", code, outcome: "confirmed" });
      await client.applyDraft(session, "draft-1", fields).catch(cause => expect(cause).not.toBeInstanceOf(ContestMutationUncertain));
    }
  });

  it("fails closed on malformed dates, modes, IDs, revisions, and old generations", async () => {
    const cases = [
      { ...result({ requestID: "request", payloadDigest: "digest" }), session: { ...session, revision: 8, updatedAt: "not-a-date" } },
      { ...result({ requestID: "request", payloadDigest: "digest" }), draft: { ...draft(), fields: { ...fields, mode: "SSB" } } },
      { ...result({ requestID: "request", payloadDigest: "digest" }), draft: { ...draft(), draftID: "wrong" } },
      { ...result({ requestID: "request", payloadDigest: "digest" }), receipt: { requestID: "request", payloadDigest: "digest", committedRevision: 9, committedAt: "2026-10-17T00:00:01Z" } },
      { ...result({ requestID: "request", payloadDigest: "digest" }), session: { ...session, revision: 8, workspaceGeneration: "old" } },
      { ...result({ requestID: "request", payloadDigest: "digest" }), draft: { ...draft(), operatorReadiness: { ...draft().operatorReadiness!, capabilityDigest: "e".repeat(64) } } },
    ];
    for (const bad of cases) {
      const request = vi.fn(async () => ({ id: "frame", ok: true as const, result: bad })) as ContestRequest;
      const client = new ContestClient(request, () => "request", async () => "digest");
      await expect(client.applyDraft(session, "draft-1", fields)).rejects.toMatchObject({ name: "ContestMutationUncertain", operation: { scope: { requestID: "request" } } });
    }
  });

  it("rejects crossed rule families and missing or unknown descriptor versions before any mutation", async () => {
    const crossedMode = structuredClone(rule) as unknown as Record<string, unknown>;
    crossedMode.mode = "SSB"; crossedMode.entry = ssbSession().rule.entry;
    const crossedFamily = structuredClone(rule) as unknown as Record<string, unknown>;
    crossedFamily.entry = { ...rule.entry, exchange: { sent: "serialNumber", received: "serialNumber", sentDefault: "reservedSerial", adifFields: "stxSrx" },
      serial: { requirement: "requiredForCommit", allowedScopes: ["session", "band", "transmitter"] } };
    const sac = structuredClone(rule) as unknown as Record<string, unknown>;
    sac.identity = { id: "sac-cw", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: "7c8b499225a73f7f8f792246881bd7aefc05452f" };
    sac.displayName = "Scandinavian Activity Contest CW";
    sac.entry = { ...rule.entry, exchange: { sent: "serialNumber", received: "serialNumber", sentDefault: "reservedSerial", adifFields: "exchangeStrings" },
      serial: { requirement: "requiredForCommit", allowedScopes: ["session", "band", "transmitter"] } };
    const wrongSACIdentity = structuredClone(sac) as Record<string, unknown>;
    wrongSACIdentity.identity = { ...(sac.identity as Record<string, unknown>), edition: "source-26.10.11" };
    const wrongSACFamily = structuredClone(sac) as Record<string, unknown>;
    (wrongSACFamily.entry as Record<string, any>).exchange.adifFields = "stxSrx";
    const missingVersion = structuredClone(rule) as unknown as Record<string, unknown>; delete missingVersion.entryDescriptorVersion;
    const unknownVersion = { ...rule, entryDescriptorVersion: 2 };
    const missingCapability = structuredClone(rule) as unknown as Record<string, unknown>; delete missingCapability.operatorCapability;
    const unknownCapability = structuredClone(rule) as unknown as Record<string, any>; unknownCapability.operatorCapability.version = 2;
    const changedCapability = structuredClone(rule) as unknown as Record<string, any>; changedCapability.operatorCapability.policy = "unreviewed";
    const mismatchedDigest = structuredClone(rule) as unknown as Record<string, any>; mismatchedDigest.operatorCapability.auditDigest = "e".repeat(64);
    const futureProfile = structuredClone(rule) as unknown as Record<string, any>; futureProfile.identity.id = "future-cw";
    for (const badRule of [crossedMode, crossedFamily, wrongSACIdentity, wrongSACFamily, missingVersion, unknownVersion,
      missingCapability, unknownCapability, changedCapability, mismatchedDigest, futureProfile]) {
      const request = vi.fn(async () => ({ id: "frame", ok: true as const, result: { workspaceGeneration: "generation-1", rules: [badRule] } }));
      const client = new ContestClient(request as ContestRequest);
      await expect(client.catalog()).rejects.toThrow("Malformed or stale contest_catalog response");
      expect(request.mock.calls).toEqual([["contest_catalog", {}]]);
    }
  });

  it("rejects an oversized SSB report in reads and treats it as uncertain after a mutation", async () => {
    const selected = ssbSession();
    const badFields: ContestDraftFields = { ...fields, mode: "SSB", sentReport: "599", receivedReport: "59" };
    const badDraft = { ...draft(7), revision: 7, fields: badFields,
      operatorReadiness: { ...draft(7).operatorReadiness, capabilityDigest: selected.rule.operatorCapability!.auditDigest } };
    const openRequest = vi.fn(async () => ({ id: "frame", ok: true as const, result: { session: selected, draft: badDraft } }));
    await expect(new ContestClient(openRequest as ContestRequest).open(selected.sessionID, selected.workspaceGeneration))
      .rejects.toThrow("Malformed or stale contest_open response");
    expect(openRequest.mock.calls).toEqual([["contest_open", { sessionID: selected.sessionID, workspaceGeneration: selected.workspaceGeneration }]]);

    const mutationRequest = vi.fn(async (_method: string, params: Record<string, unknown> = {}) => ({ id: "frame", ok: true as const, result: {
      session: { ...selected, revision: 8 }, draft: { ...badDraft, revision: 8 },
      receipt: { requestID: params.requestID, payloadDigest: params.payloadDigest, committedRevision: 8, committedAt: "2026-10-17T00:00:01Z" },
    } }));
    const client = new ContestClient(mutationRequest as ContestRequest, () => "request", async () => "digest");
    await expect(client.applyDraft(selected, badDraft.draftID, { ...badDraft.fields, sentReport: "59" }))
      .rejects.toMatchObject({ name: "ContestMutationUncertain", operation: { scope: { requestID: "request" } } });
    expect(mutationRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects non-finite and oversized outbound values before digesting", async () => {
    expect(() => canonicalJSON({ frequencyHz: Number.NaN })).toThrow("finite");
    expect(() => canonicalJSON({ frequencyHz: Number.POSITIVE_INFINITY })).toThrow("finite");
    expect(() => validateDraftFields({ ...fields, callsign: "X".repeat(33) })).toThrow("oversized");
    expect(() => validateDraftFields({ ...fields, sentReport: "5999" })).toThrow("oversized");
    expect(() => validateCreateInput({ name: "😀".repeat(64), ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion,
      station: session.station, operator: session.operator })).toThrow("oversized");
    const digest = vi.fn(async () => "digest");
    const client = new ContestClient(vi.fn() as ContestRequest, () => "request", digest);
    await expect(client.applyDraft(session, "draft-1", { ...fields, frequencyHz: Number.NaN })).rejects.toThrow("invalid");
    expect(digest).not.toHaveBeenCalled();
  });

  it("allows partial callsign drafts to reach backend validation and remain editable", () => {
    expect(() => validateDraftFields({ ...fields, callsign: "K" })).not.toThrow();
    expect(() => validateDraftFields({ ...fields, callsign: "K1" })).not.toThrow();
    expect(() => validateDraftFields({ ...fields, callsign: "K1/" })).not.toThrow();
  });

  it("pins exact rule and reference identities into a preallocated create scope", async () => {
    const request = vi.fn(async (_method, params = {}) => ({ id: "frame", ok: true as const, result: result(params) })) as ContestRequest;
    const ids = ["session-new", "request-new"]; const client = new ContestClient(request, () => ids.shift()!, async () => "digest");
    await client.create("generation-1", { name: "WW", ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion, station: session.station, operator: session.operator }).catch(() => undefined);
    expect(request).toHaveBeenCalledWith("contest_create", expect.objectContaining({ sessionID: "session-new", expectedRevision: 0, payload: expect.objectContaining({ sessionID: "session-new", ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion }) }));
  });

  it("keeps the original commit identity when a committed reply is malformed", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ id: "frame", ok: true, result: { ...result({ requestID: "request-commit", payloadDigest: "digest" }), receipt: { requestID: "request-commit", payloadDigest: "digest", committedRevision: 99, committedAt: "2026-10-17T00:00:01Z" } } })
      .mockResolvedValueOnce({ id: "frame", ok: true, result: { status: "not_found" } }) as ContestRequest;
    const client = new ContestClient(request, () => "request-commit", async () => "digest"); let uncertain!: ContestMutationUncertain;
    try { await client.commitQSO(session, "draft-1"); } catch (cause) { uncertain = cause as ContestMutationUncertain; }
    expect(uncertain.operation.scope.requestID).toBe("request-commit"); await client.receipt(uncertain.operation);
    expect(request).toHaveBeenLastCalledWith("contest_operation_receipt", expect.objectContaining({ requestID: "request-commit", sessionID: "session-1" }));
  });

  it("keeps the preallocated create session and request IDs when its committed reply is malformed", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ id: "frame", ok: true, result: { session: { ...session, sessionID: "wrong-session" }, draft: draft(), receipt: { requestID: "request-create", payloadDigest: "digest", committedRevision: 1, committedAt: "2026-10-17T00:00:01Z" } } })
      .mockResolvedValueOnce({ id: "frame", ok: true, result: { status: "not_found" } }) as ContestRequest;
    const generated = ["session-create", "request-create"], client = new ContestClient(request, () => generated.shift()!, async () => "digest"); let uncertain!: ContestMutationUncertain;
    try { await client.create("generation-1", { name: "WW", ruleIdentity: rule.identity, referenceDataVersion: rule.referenceDataVersion, station: session.station, operator: session.operator }); } catch (cause) { uncertain = cause as ContestMutationUncertain; }
    expect(uncertain.operation.scope).toMatchObject({ sessionID: "session-create", requestID: "request-create", expectedRevision: 0 });
    await client.receipt(uncertain.operation); expect(request).toHaveBeenLastCalledWith("contest_operation_receipt", expect.objectContaining({ sessionID: "session-create", requestID: "request-create" }));
  });

  it("generates one finite operation timestamp and preserves it while receipt lookup stays unchanged", async () => {
    const timestamp = "2026-10-17T03:04:05.000Z";
    const mock = vi.fn().mockRejectedValueOnce(new Error("reply lost")).mockImplementationOnce(async (_method, params) => ({ id: "frame", ok: true, result: result(params) })).mockResolvedValueOnce({ id: "frame", ok: true, result: { status: "not_found" } });
    const request = mock as ContestRequest;
    const client = new ContestClient(request, () => "timestamp-request", async () => "digest", undefined, () => timestamp); let uncertain!: ContestMutationUncertain;
    try { await client.applyDraft(session, "draft-1", fields); } catch (cause) { uncertain = cause as ContestMutationUncertain; }
    expect(uncertain.operation.scope.operationTimestamp).toBe(timestamp);
    await client.retry(uncertain.operation); expect(mock.mock.calls[1][1].operationTimestamp).toBe(timestamp);
    await client.receipt(uncertain.operation);
    expect(mock.mock.calls[2][1]).toEqual({ sessionID: "session-1", workspaceGeneration: "generation-1", requestID: "timestamp-request", payloadDigest: "digest" });
  });

  it("rejects a noncanonical operation timestamp before dispatch", async () => {
    const request = vi.fn() as ContestRequest;
    const client = new ContestClient(request, () => "request", async () => "digest", undefined, () => "2026-10-17T03:04:05+00:00");
    await expect(client.applyDraft(session, "draft-1", fields)).rejects.toThrow("canonical UTC ISO timestamp");
    expect(request).not.toHaveBeenCalled();
  });

  it("sends an explicit call-history selection through the normal mutation envelope", async () => {
    const request = vi.fn(async () => ({ id: "frame", ok: false as const,
      error: { code: "fixture_stop", message: "captured", outcome: "confirmed" as const } })) as ContestRequest;
    const client = new ContestClient(request, () => "history-request", async () => "history-digest",
      undefined, () => "2026-10-17T03:04:05.000Z");
    const projected = { ...fields, receivedExchange: "04" };
    const selection = {
      context: { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration,
        sessionRevision: session.revision, draftID: "draft-1", draftRevision: 8,
        inputCallsign: "K1ABC", requestID: "history-query", ruleIdentity: rule.identity,
        referenceDataVersion: session.referenceDataVersion },
      dataset: { generation: "history-generation", sha256: "a".repeat(64), sourceName: "history.any",
        importedAtUTC: "2026-10-17T00:00:00.000Z", byteCount: 1, recordCount: 1,
        indexableRecordCount: 1, unindexableRecordCount: 0, duplicateCallCount: 0 },
      record: { recordID: "record-1", sourceOrdinal: 0, sourceLine: 2, normalizedCallsign: "K1ABC",
        indexingIssue: null, values: [] },
      projections: [{ id: "legacy-received-zone", sourceKey: "cqzone", target: "legacyReceivedExchange",
        fieldID: null, label: "CQ zone", rawValue: "04", normalizedValue: "04" }],
    } as HistorySelection;
    await expect(client.applyHistoryProjection(session, "draft-1", selection,
      ["legacy-received-zone"], projected)).rejects.toMatchObject({ code: "fixture_stop", outcome: "confirmed" });
    expect(request).toHaveBeenCalledWith("contest_history_apply", expect.objectContaining({
      sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration,
      expectedRevision: session.revision, draftID: "draft-1", requestID: "history-request",
      payloadDigest: "history-digest", payload: {
        selection: { ...selection.context, recordID: selection.record.recordID },
        projectionIDs: ["legacy-received-zone"], fields: projected,
      },
    }));
  });

  it("fails closed on unknown and malformed structured descriptor versions", async () => {
    const identity = { id: "naqp-rtty", version: "1.0.0-2026-rules-preview", edition: "2026-rules-preview", sourceRevision: "0c98451d9dc4111dbb371c0a7d806a5ccd88624e21b1553672e9066c417064e8" };
    const malformed = { identity, displayName: "North American QSO Party RTTY", mode: "RTTY", entryDescriptorVersion: 2,
      entry: { version: 2, mode: "RTTY", adifMode: "RTTY", cabrilloQSOType: "RY", cabrilloFormatterVersion: "naqp-preview-1", cabrilloProjectionFormatterVersion: "naqp-preview-1",
        report: { format: "none", defaultSent: "", defaultReceived: "", maximumUTF8Bytes: 0 },
        exchange: { sent: "structured", received: "structured", sentDefault: "stationFields", adifFields: "exchangeStrings", sentFields: [], receivedFields: [] },
        serial: { requirement: "none", allowedScopes: [] }, modeProfiles: [], scorePolicy: "pointsTimesMultipliers" },
      referenceDataVersion: "cty", sourceVerification: "provisional", sourceNote: "preview" };
    for (const candidate of [{ ...malformed, entryDescriptorVersion: 3 }, malformed]) {
      const request = vi.fn(async () => ({ id: "frame", ok: true as const, result: { workspaceGeneration: "generation-1", rules: [candidate] } })) as ContestRequest;
      await expect(new ContestClient(request).catalog()).rejects.toThrow("Malformed or stale contest_catalog response");
    }
  });
});
