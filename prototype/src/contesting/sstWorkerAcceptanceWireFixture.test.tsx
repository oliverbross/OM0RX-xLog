// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import fixtureJSON from "../../../docs/contesting/fixtures/sst-worker-acceptance-wire.json";
import { ContestClient } from "./client";
import { ContestOperatorPanel, type ContestSimulationEntry } from "./ContestOperatorPanel";
import type { ContestCommitResult, ContestDraftSnapshot, ContestRequest, ContestSessionSummary } from "./types";

const fixture = fixtureJSON as any;
const catalogRequest = (catalog: any): ContestRequest => async () => catalog;

afterEach(cleanup);

function OperatorHarness({ session, draft, style, sent }: { session: ContestSessionSummary; draft: ContestDraftSnapshot;
  style: "run" | "search-and-pounce"; sent: ContestSimulationEntry[] }) {
  const root = useRef<HTMLFormElement>(null);
  return <form ref={root}><ContestOperatorPanel session={session} draft={draft} entryRoot={root} editGeneration={0}
    disabled={false} recovery={null} reserveSerial={async () => { throw new Error("SST has no serial reservation"); }}
    commitQSO={() => new Promise<ContestCommitResult>(() => {})} admitIntent={() => true} guardFormSubmit={() => {}}
    focusField={() => {}} simulateOutput={async entry => { sent.push(entry); }}/>
    <input aria-label="Call" data-contest-operator-field="callsign" />
    <input aria-label="Exchange" data-contest-operator-field="exchange" />
    <button type="button" onClick={() => fireEvent.change(screen.getByLabelText("Operating style"), { target: { value: style } })}>
      Select style
    </button></form>;
}

describe("SST real-worker pre-activation fixture", () => {
  it("roundtrips the injected immutable definition through the strict client", async () => {
    const catalog = await new ContestClient(catalogRequest(fixture.catalog)).catalog();
    const rule = catalog.rules.find(candidate => candidate.identity.id === "k1usn-sst")!;
    expect(fixture.scope).toBe("pre-activation injected immutable definition; SST is not in the built-in catalog");
    expect(rule.identity).toEqual({ id: "k1usn-sst", version: "2.0.0-declarative-archive",
      edition: "official-rules-and-faq-2026-10-18", sourceRevision: rule.declarativeDefinition!.definitionDigest });
    expect(rule.referenceDataVersion).toBe(fixture.referenceDataVersion);
    expect(rule.declarativeDefinition).toEqual({ definitionDigest: rule.identity.sourceRevision,
      immutablePerSession: true, exportPurpose: "operatorArchive", submissionReady: false });
    expect(rule.entry.report).toEqual({ format: "none", defaultSent: "", defaultReceived: "", maximumUTF8Bytes: 0 });
    expect(rule.entry.serial).toEqual({ requirement: "none", allowedScopes: [] });
    expect(rule.operatorCapability).toEqual({ version: 1, auditDigest: rule.identity.sourceRevision,
      policy: "simulated-run-sp-v1", output: "simulation-only", styles: ["run", "search-and-pounce"],
      macros: ["CQ", "EXCH", "QRZ", "AGN", "HISCALL", "MYCALL", "QSOB4"],
      signalProfiles: [{ mode: "CW", signal: "cw" }] });
    expect(fixture.cqReady.response.result.draft.operatorReadiness).toEqual({ capabilityDigest: rule.identity.sourceRevision,
      callsign: "empty", exchange: "empty", canSendCQ: true, canSendCall: false, canSendDuplicate: false,
      canReserveCall: false, canReserveCommit: false, canCommit: false });
    expect(fixture.officialSample).toMatchObject({ contactCount: 12,
      expected: { points: 12, multipliers: 10, claimedScore: 120 },
      actual: { qsos: 12, points: 12, multipliers: 10, claimedScore: 120 } });
    expect(fixture.extraContacts.note).toContain("outside the official 12-contact scoring sample");
    expect(fixture.extraContacts.duplicateApply.result.draft.operatorReadiness)
      .toMatchObject({ canSendDuplicate: true, canCommit: false });
    expect(fixture.extraContacts.nlApply.result.draft.fields.receivedExchange).toBe("AL NL");
    expect(fixture.correction.openAfterRestart.result.session.qsoCount).toBe(13);
    expect(fixture.deletionRecovery.response.result.score).toMatchObject({ qsos: 12, points: 12, multipliers: 10, claimedScore: 120 });
    expect(fixture.deletionRecovery.openAfterRestart.result.session.qsoCount).toBe(12);
    for (const format of ["cabrillo", "adif"] as const) {
      expect(fixture.exports[format].prepareResponse.result.declarativePurpose).toBe("operatorArchive");
    }
    const adif = atob(fixture.exports.adif.readResponse.result.dataBase64);
    expect(adif).toContain("<NAME:5>ALLEN");
    expect(adif).toContain("<STATE:2>NL");
    expect(adif).toContain("<SRX_STRING:8>ALLEN NL");
    expect(adif).toContain("<STX_STRING:7>DAVE MA");
    expect(adif).toContain("<MY_NAME:4>DAVE");
    expect(adif).toContain("<MY_STATE:2>MA");
  });

  it("renders exact no-report Run and S&P macro text from worker readiness", async () => {
    const runSent: ContestSimulationEntry[] = [];
    const runResult = fixture.cqReady.response.result;
    const runView = render(<OperatorHarness session={runResult.session} draft={runResult.draft} style="run" sent={runSent}/>);
    fireEvent.click(screen.getByRole("button", { name: "Select style" }));
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Call"), { key: "Enter" });
    await waitFor(() => expect(runSent).toMatchObject([{ macro: "CQ", text: "CQ CQ DE K1USN K1USN K" }]));
    runView.unmount();

    const spSent: ContestSimulationEntry[] = [];
    const spResult = fixture.extraContacts.nlApply.result;
    render(<OperatorHarness session={spResult.session} draft={spResult.draft} style="search-and-pounce" sent={spSent}/>);
    fireEvent.click(screen.getByRole("button", { name: "Select style" }));
    fireEvent.click(screen.getByRole("button", { name: "Arm simulation" }));
    fireEvent.keyDown(screen.getByLabelText("Exchange"), { key: "Enter" });
    await waitFor(() => expect(spSent).toMatchObject([{ macro: "EXCH", text: "DAVE MA" }]));
  });

  it("accepts exact 128-byte identities and rejects 129 bytes, including multibyte editions", async () => {
    const cases = [
      ["id", `a${"b".repeat(127)}`, `a${"b".repeat(128)}`],
      ["version", "v".repeat(128), "v".repeat(129)],
      ["edition", "é".repeat(64), `${"é".repeat(64)}a`],
    ] as const;
    for (const [field, exact, tooLong] of cases) {
      const exactCatalog = structuredClone(fixture.catalog);
      const exactRule = exactCatalog.result.rules.find((candidate: any) => candidate.identity.id === "k1usn-sst");
      exactRule.identity[field] = exact;
      await expect(new ContestClient(catalogRequest(exactCatalog)).catalog()).resolves.toBeTruthy();

      const rejectedCatalog = structuredClone(fixture.catalog);
      const rejectedRule = rejectedCatalog.result.rules.find((candidate: any) => candidate.identity.id === "k1usn-sst");
      rejectedRule.identity[field] = tooLong;
      await expect(new ContestClient(catalogRequest(rejectedCatalog)).catalog())
        .rejects.toThrow("Malformed or stale contest_catalog response");
    }
  });
});
