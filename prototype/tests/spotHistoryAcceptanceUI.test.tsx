// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { SpotHistoryPanel } from "../src/live/SpotHistoryPanel";
import { verifySpotHistory } from "../src/spotHistoryAcceptance";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("runs the packaged acceptance interactions against the production history component", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const rows = Array.from({ length: 137 }, (_, i) => {
    const callsign = i % 2 === 0 ? "TESTH0" : "TESTH1";
    const comment = `Synthetic acceptance <not-markup> Ω report ${i}`;
    return { id: String(i), sessionID: "fixture", sequence: i + 1, clusterID: "fixture", clusterHost: "fixture.invalid", clusterName: "Isolated fixture",
      arrivedAt: new Date(Date.now() - 1000 * (600 - i)).toISOString(), reportedAt: null, timeBasis: "arrival", recordKind: "live",
      callsign, spotter: "TESTSPOT", frequencyKHz: 14025, frequencyText: "14025.0", band: "20m", mode: "CW", source: "fixture", country: "Synthetic",
      adif: null, comment, specialTags: [], callStatus: "", dxccStatus: "", rawLine: `DX de TESTSPOT: 14025.0 ${callsign} ${comment}`, classificationJSON: '{"fixture":true}' };
  }).reverse();
  const request = vi.fn(async (method: string, params: Record<string, any> = {}) => {
    const filtered = rows.filter(row => !params.call || row.callsign === params.call);
    if (method === "logbook_operator_draft") return { draft: { qso: { id: "draft", call: "" } } };
    if (method === "spot_history_query") {
      const offset = Number(params.cursor ?? 0), limit = params.limit ?? 100;
      return { page: { rows: filtered.slice(offset, offset + limit), nextCursor: offset + limit < filtered.length ? String(offset + limit) : null, watermark: 137, revision: 2 } };
    }
    if (method === "spot_history_stats") return { stats: { total: filtered.length, distinctCalls: params.call ? filtered.length ? 1 : 0 : 2, distinctSpotters: 1,
      bands: [], modes: [], countries: [], sources: [], spotters: [], hourly: [], earliest: null, latest: null, watermark: 137, revision: 2, bucketsTruncated: false } };
    if (method === "spot_history_detail") return { observation: rows.find(row => row.id === params.id) };
    if (method === "spot_history_status") return { status: { total: 137, revision: 2, fileBytes: 4096, schemaVersion: 2, earliest: null, latest: null, lastCommit: null },
      recording: { state: "idle", queued: 0, unrecorded: 0, errorCode: null, startedAt: new Date().toISOString(), connections: [] } };
    throw new Error(`Unexpected method ${method}`);
  });
  const rendered = render(<main />);
  let mount = 0;
  const result = await verifySpotHistory({
    worker: async (method, params) => ({ result: await request(method, params) }),
    navigate: async name => { rendered.rerender(name === "Spot History" ? <SpotHistoryPanel key={++mount} request={request} /> : <main />); },
    fill: async (selector, value) => { fireEvent.change(document.querySelector(selector)!, { target: { value } }); },
    click: async (name, selector = "button") => {
      let button: HTMLButtonElement | undefined;
      await waitFor(() => {
        button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(item => item.textContent?.trim() === name);
        expect(button && !button.disabled).toBe(true);
      });
      fireEvent.click(button!);
    },
  });
  expect(result).toMatchObject({ retainedReports: 137, filteredReports: 69, nativeTable: true, draftUnchanged: true, stationIO: false });
  expect(request.mock.calls.every(([method]) => method.startsWith("spot_history_") || method === "logbook_operator_draft")).toBe(true);
});
