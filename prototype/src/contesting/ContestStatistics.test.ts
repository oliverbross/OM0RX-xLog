import { describe, expect, it, vi } from "vitest";
import { ContestClient } from "./client";
import type { ContestRequest, ContestSessionSummary, ContestStatistics } from "./types";

const session = { sessionID: "session-1", workspaceGeneration: "generation-1", revision: 7 } as ContestSessionSummary;
const band = { band: "20m", loggedQSOs: 2, acceptedQSOs: 1, distinctCallsigns: 1,
  modes: { cw: 2, phone: 0, digital: 0, other: 0 }, distinctWPXPrefixes: 1, creditedPoints: 3 };
const result: ContestStatistics = { sessionID: session.sessionID, workspaceGeneration: session.workspaceGeneration, revision: 7,
  asOfUTC: "2026-10-18T00:00:00.000Z", fullLogQSOs: 2, loggedQSOs: 2, acceptedQSOs: 1, duplicateQSOs: 1, invalidQSOs: 0,
  currentHourQSOs: 2, operatorStyles: { total: { run: 1, searchAndPounce: 1, unknown: 0 }, currentHour: { run: 1, searchAndPounce: 1, unknown: 0 } },
  trailing60Minutes: { qsoCount: 2, spanSeconds: 60, qsosPerHour: 120 }, latest10: null, latest100: null, bands: [band],
  total: { ...band, band: "total" } };
const client = (value: unknown) => new ContestClient(vi.fn(async () => ({ id: "frame", ok: true as const, result: value })) as ContestRequest);

describe("contest statistics client contract", () => {
  it("admits the exact atomic worker snapshot", async () => { await expect(client(result).statistics(session)).resolves.toEqual(result); });
  it.each([
    { ...result, extra: true },
    { ...result, revision: 8 },
    { ...result, asOfUTC: "2026-10-18T00:00:00Z" },
    { ...result, acceptedQSOs: 2 },
    { ...result, operatorStyles: { ...result.operatorStyles, total: { run: 2, searchAndPounce: 1, unknown: 0 } } },
    { ...result, trailing60Minutes: { qsoCount: 3, spanSeconds: 60, qsosPerHour: 180 } },
    { ...result, loggedQSOs: 10, fullLogQSOs: 10, acceptedQSOs: 9, latest10: null,
      total: { ...result.total, loggedQSOs: 10, acceptedQSOs: 9, modes: { cw: 10, phone: 0, digital: 0, other: 0 } } },
    { ...result, total: { ...result.total, band: "TOTAL" } },
    { ...result, bands: [{ ...band, modes: { ...band.modes, phone: 1 } }] },
  ])("rejects malformed, stale, or internally inconsistent snapshots %#", async value => {
    await expect(client(value).statistics(session)).rejects.toThrow("Malformed or stale contest_statistics response.");
  });
});
