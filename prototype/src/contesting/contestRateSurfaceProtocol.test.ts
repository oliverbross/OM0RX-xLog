import { describe, expect, it } from "vitest";
import { validContestSurfaceProjection } from "./contestSurfaceProtocol";

const rate = { schemaVersion: 1, status: "ready", sessionRevision: 7, asOfUTC: "2026-10-18T00:00:00.000Z",
  fullLogQSOs: 2, loggedQSOs: 2, acceptedQSOs: 1, duplicateQSOs: 1, invalidQSOs: 0, currentHourQSOs: 2,
  operatorStyles: { total: { run: 1, searchAndPounce: 1, unknown: 0 }, currentHour: { run: 1, searchAndPounce: 1, unknown: 0 } },
  trailing60Minutes: { qsoCount: 2, spanSeconds: 60, qsosPerHour: 120 }, latest10: null, latest100: null, busy: false } as const;
const band = { band: "20m", loggedQSOs: 2, acceptedQSOs: 1, distinctCallsigns: 1, modes: { cw: 2, phone: 0, digital: 0, other: 0 },
  distinctWPXPrefixes: 1, creditedPoints: 3 } as const;
const score = { qsos: 2, points: 3, multipliers: 1, claimedScore: 3, multiplierLabels: ["K"], multiplierDisplayLabels: ["United States"], sourceVerification: "verified" } as const;
const statistics = { schemaVersion: 2, status: "ready", score, busy: false, sessionRevision: 7, asOfUTC: rate.asOfUTC,
  fullLogQSOs: 2, loggedQSOs: 2, acceptedQSOs: 1, duplicateQSOs: 1, invalidQSOs: 0, bands: [band], total: { ...band, band: "total" } } as const;

describe("contest rate and statistics surface projections", () => {
  it("admits exact monitor v1 and propagation v2 projections", () => {
    expect(validContestSurfaceProjection("monitor", rate)).toBe(true);
    expect(validContestSurfaceProjection("propagation", statistics)).toBe(true);
    expect(validContestSurfaceProjection("propagation", { schemaVersion: 1, status: "ready", score, busy: false })).toBe(true);
  });
  it.each([
    ["monitor", { ...rate, asOfUTC: "2026-10-18T00:00:00Z" }],
    ["monitor", { ...rate, latest10: { qsoCount: 10, spanSeconds: 60, qsosPerHour: 600 } }],
    ["monitor", { ...rate, operatorStyles: { ...rate.operatorStyles, total: { run: 2, searchAndPounce: 1, unknown: 0 } } }],
    ["propagation", { ...statistics, bands: [{ ...band, modes: { ...band.modes, phone: 1 } }] }],
    ["propagation", { ...statistics, total: { ...statistics.total, band: "TOTAL" } }],
    ["propagation", { ...statistics, score: { ...score, qsos: 1 } }],
  ])("rejects malformed %s projection %#", (panelID, value) => expect(validContestSurfaceProjection(panelID as "monitor", value)).toBe(false));
});
