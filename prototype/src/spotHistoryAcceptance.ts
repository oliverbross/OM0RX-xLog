import { waitForAcceptance } from "./acceptance";

type Json = Record<string, any>;
type Controls = {
  worker: (method: string, params?: Json) => Promise<Json>;
  navigate: (name: string) => Promise<void>;
  fill: (selector: string, value: string) => Promise<void>;
  click: (name: string, selector?: string) => Promise<void>;
};
export function validHistoryFixture(first: Json, second: Json, stats: Json) {
  const rows = [...(first.rows ?? []), ...(second.rows ?? [])];
  return first.rows?.length === 100 && second.rows?.length === 37 &&
    first.watermark === second.watermark && new Set(rows.map(row => row.id)).size === 137 &&
    rows.every(row => row.clusterHost === "fixture.invalid" && row.source === "fixture") &&
    stats.total === 137 && stats.distinctCalls === 2 && stats.distinctSpotters === 1;
}

/** Generated archive only. The native acceptance worker creates and closes the
 * SQLite fixture before the production reader opens it. No cluster transport,
 * external database path or recording simulator is exposed to the renderer. */
export async function verifySpotHistory({ worker, navigate, fill, click }: Controls) {
  const first = (await worker("spot_history_query", { limit: 100 })).result.page;
  const second = (await worker("spot_history_query", { limit: 100, cursor: first.nextCursor, watermark: first.watermark })).result.page;
  const stats = (await worker("spot_history_stats", { watermark: first.watermark })).result.stats;
  if (!validHistoryFixture(first, second, stats)) throw new Error("Retained history fixture did not roundtrip through the packaged worker.");
  const before = (await worker("logbook_operator_draft")).result.draft.qso;
  await navigate("Spot History");
  const ready = () => document.querySelector('.spot-history-table-wrap[aria-busy="false"]') !== null;
  await waitForAcceptance("retained history native table", () => ready() && document.querySelectorAll(".spot-history-table tbody tr").length > 0 &&
    document.querySelector(".spot-history-summary strong")?.textContent === "137");
  await click("Next", ".spot-history-footer button");
  await waitForAcceptance("history next snapshot page", () => ready() && document.querySelector(".spot-history-footer")?.textContent?.includes("Page 2") === true);
  await fill('[aria-label="History callsign"]', "TESTH0");
  await click("Search", ".spot-history-filters button");
  await waitForAcceptance("history filtered statistics", () => ready() && document.querySelector(".spot-history-summary strong")?.textContent === "69" &&
    [...document.querySelectorAll(".history-call-value")].every(row => row.textContent === "TESTH0"));
  const row = document.querySelector<HTMLTableRowElement>(".spot-history-table tbody tr");
  if (!row) throw new Error("Missing filtered history report.");
  row.click();
  await click("Details", ".spot-history-footer button");
  await waitForAcceptance("history original source details", () => document.querySelector(".spot-history-detail")?.textContent?.includes("DX de TESTSPOT: 14025.0 TESTH0 Synthetic acceptance <not-markup> Ω") === true);
  if (document.querySelector(".spot-history-detail not-markup")) throw new Error("History source rendered as markup.");
  await click("Close details", ".spot-history-detail button");
  await waitForAcceptance("history detail close focus", () => !document.querySelector(".spot-history-detail") && document.activeElement?.textContent === "Details");
  await fill('[aria-label="History callsign"]', "NOHISTORY");
  await click("Search", ".spot-history-filters button");
  await waitForAcceptance("history empty filtered result", () => ready() && document.querySelector(".spot-history-empty")?.textContent?.includes("No reports match this search") === true);
  await navigate("Operator Desk");
  await navigate("Spot History");
  await waitForAcceptance("retained archive after route remount", () => ready() && document.querySelector(".spot-history-summary strong")?.textContent === "137");
  const after = (await worker("logbook_operator_draft")).result.draft.qso;
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Read-only history changed the operator draft.");
  return { retainedReports: 137, filteredReports: 69, distinctCalls: 2, uniquePageIDs: 137,
    nativeTable: true, originalSource: true, escapedText: true, emptySearch: true, remount: true,
    draftUnchanged: true, stationIO: false, network: false };
}
