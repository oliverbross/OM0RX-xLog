// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ContestLogTransferWindow } from "./ContestLogTransferWindow";
import type { ContestLogTransferAPI, TransferResult } from "./contestLogTransferNative";

afterEach(cleanup);
const preview = { source:{identity:"legacy-source",digest:"a".repeat(64),byteLength:4096}, station:{Call:"OM0RX"}, contests:[{
  contestNR:7,contestName:"CQ-WW-CW",rowCount:2,firstUTC:"2026-10-18 01:02:03",lastUTC:"2026-10-18 01:03:04",frequencyHz:14025000,
  exchangeValues:["15"],settings:{ModeCategory:"CW"},pluginCandidates:["cq_ww_cw"],
}] };
const prepared: TransferResult = { phase:"prepared",manifest:{manifestID:"40000000-0000-4000-8000-000000000001",contestSessionID:"20000000-0000-4000-8000-000000000001",workspaceGeneration:"30000000-0000-4000-8000-000000000001",sourceRevision:7,sourceDigest:"b".repeat(64),provenance:"not1mm-python:test",qsoCount:3},inserted:[],alreadyTransferred:[{}],conflicts:[],errors:[],counts:{total:3,inserted:0,alreadyTransferred:1,conflicts:0,errors:0,pending:2} };
function fixture(): ContestLogTransferAPI {
  return { context:vi.fn(async()=>({workspaceGeneration:"30000000-0000-4000-8000-000000000001",stationCall:"OM0RX",sessionID:"20000000-0000-4000-8000-000000000001",expectedRevision:7,contestName:"CQ WW CW",qsoCount:3})),
    chooseLegacy:vi.fn(async()=>preview),importLegacy:vi.fn(async()=>({legacyImport:{importedRows:2}})),transfer:vi.fn(async()=>prepared) };
}

it("keeps the legacy path native and requires an explicit confirmation before import", async () => {
  const api=fixture(); render(<ContestLogTransferWindow api={api}/>);
  fireEvent.click(screen.getByRole("button",{name:"Choose Not1MM database…"}));
  await screen.findByText("CQ-WW-CW · 2 contacts");
  expect(document.body.textContent).not.toContain("/Users/");
  const review = screen.getByRole("button",{name:"Review import…"});
  await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(review);
  expect(api.importLegacy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Import 2 contacts"}));
  await waitFor(()=>expect(api.importLegacy).toHaveBeenCalledOnce());
  const params=vi.mocked(api.importLegacy).mock.calls[0][0];
  expect(params).not.toHaveProperty("sourcePath");
  expect(params).not.toHaveProperty("sessionID");
  expect(params).not.toHaveProperty("operationID");
  expect(params).toMatchObject({sourceIdentity:"legacy-source",sourceContestNR:7,pluginID:"cq_ww_cw",frequencyHz:14025000,station:{Call:"OM0RX"}});
});

it("uses the xLog callsign when the legacy database has no station row", async () => {
  const api=fixture(); vi.mocked(api.chooseLegacy).mockResolvedValue({...preview,station:null});
  render(<ContestLogTransferWindow api={api}/>);
  fireEvent.click(screen.getByRole("button",{name:"Choose Not1MM database…"}));
  await screen.findByText("CQ-WW-CW · 2 contacts");
  expect((screen.getByRole("button",{name:"Review import…"}) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button",{name:"Review import…"}));
  fireEvent.click(screen.getByRole("button",{name:"Import 2 contacts"}));
  await waitFor(()=>expect(api.importLegacy).toHaveBeenCalled());
  expect(vi.mocked(api.importLegacy).mock.calls[0][0]).toMatchObject({station:{Call:"OM0RX"},operator:"OM0RX",frequencyHz:14025000});
});

it("retries an ambiguous legacy-import delivery through the same native-owned scope", async () => {
  const api=fixture();
  vi.mocked(api.importLegacy).mockRejectedValueOnce(new Error("reply lost")).mockResolvedValueOnce({legacyImport:{importedRows:2}});
  render(<ContestLogTransferWindow api={api}/>);
  fireEvent.click(screen.getByRole("button",{name:"Choose Not1MM database…"}));
  await screen.findByText("CQ-WW-CW · 2 contacts");
  const review=screen.getByRole("button",{name:"Review import…"});
  await waitFor(()=>expect((review as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(review);
  fireEvent.click(screen.getByRole("button",{name:"Import 2 contacts"}));
  await screen.findByText("reply lost");
  fireEvent.click(screen.getByRole("button",{name:"Import 2 contacts"}));
  await waitFor(()=>expect(api.importLegacy).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.importLegacy).mock.calls[1][0]).toEqual(vi.mocked(api.importLegacy).mock.calls[0][0]);
});

it("prepares the exact active snapshot and commits only after confirmation", async () => {
  const api=fixture(); render(<ContestLogTransferWindow api={api}/>);
  fireEvent.click(screen.getByRole("tab",{name:/Active contest/}));
  await screen.findByText("CQ WW CW");
  fireEvent.click(screen.getByRole("button",{name:"Preview transfer"}));
  await screen.findByRole("button",{name:"Transfer to Logbook"});
  expect(api.transfer).toHaveBeenCalledExactlyOnceWith("contest_log_transfer_prepare",{
    sessionID:"20000000-0000-4000-8000-000000000001",workspaceGeneration:"30000000-0000-4000-8000-000000000001",expectedRevision:7,
  });
  fireEvent.click(screen.getByRole("button",{name:"Transfer to Logbook"}));
  await waitFor(()=>expect(api.transfer).toHaveBeenLastCalledWith("contest_log_transfer_commit",{
    sessionID:"20000000-0000-4000-8000-000000000001",workspaceGeneration:"30000000-0000-4000-8000-000000000001",expectedRevision:7,manifestID:"40000000-0000-4000-8000-000000000001",
  }));
});

it("refreshes the native active session after legacy import so it can transfer immediately", async () => {
  const api=fixture();
  const importedContext={workspaceGeneration:"30000000-0000-4000-8000-000000000001",stationCall:"OM0RX",sessionID:"20000000-0000-4000-8000-000000000002",expectedRevision:2,contestName:"Imported CQ WW CW",qsoCount:2};
  vi.mocked(api.context).mockResolvedValueOnce({workspaceGeneration:importedContext.workspaceGeneration,stationCall:"OM0RX"}).mockResolvedValue(importedContext);
  render(<ContestLogTransferWindow api={api}/>);
  fireEvent.click(screen.getByRole("tab",{name:/Active contest/}));
  await screen.findByText("Open a contest session in Contest Setup before preparing a transfer.");
  expect((screen.getByRole("button",{name:"Preview transfer"}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("tab",{name:"Legacy Not1MM"}));
  fireEvent.click(screen.getByRole("button",{name:"Choose Not1MM database…"}));
  await screen.findByText("CQ-WW-CW · 2 contacts");
  const review=screen.getByRole("button",{name:"Review import…"});
  await waitFor(()=>expect((review as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(review);
  fireEvent.click(screen.getByRole("button",{name:"Import 2 contacts"}));
  await screen.findByText("2 contacts imported into a new xLog contest session.");
  fireEvent.click(screen.getByRole("tab",{name:/Active contest/}));
  await screen.findByText("Imported CQ WW CW");
  const prepare=screen.getByRole("button",{name:"Preview transfer"});
  await waitFor(()=>expect((prepare as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(prepare);
  await waitFor(()=>expect(api.transfer).toHaveBeenCalledExactlyOnceWith("contest_log_transfer_prepare",{
    sessionID:importedContext.sessionID,workspaceGeneration:importedContext.workspaceGeneration,expectedRevision:2,
  }));
});
