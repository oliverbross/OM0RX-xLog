// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestSetupPanel, newContestSetup } from "./ContestSetupPanel";
import { contestCapabilities, contestExchangeSample, contestPreflight } from "./contestReadiness";
import { practiceContestSetup } from "./contestPractice";

afterEach(cleanup);
it("uses accepted matrix outcomes for six different contest families without certifying sponsor rules", () => {
  for (const id of ["cq_ww_cw", "cq_wpx_cw", "naqp_cw", "iaru_hf", "cq_ww_vhf", "cqws"]) {
    const items = contestCapabilities(id);
    expect(items.find(item => item.label === "Core logging and export")?.status).toBe(id === "cqws" ? "LIMITED" : "ACCEPTED");
    expect(items.find(item => item.label === "Installed workflow")?.status).toBe("UNVERIFIED");
    expect(items.find(item => item.label === "Current sponsor rules")?.status).toBe("UNVERIFIED");
  }
  expect(contestCapabilities("not-registered")[0].status).toBe("UNVERIFIED");
});

it("preflights UTC boundaries and repeated reports while missing output evidence does not block manual logging", () => {
  const document = newContestSetup("OM0RX");
  document.pluginID = "naqp_ssb";
  Object.assign(document.settings, { StartDate: "2026-10-27 00:00:00", EndDate: "2026-10-27 01:00:00", SentExchange: "599 OLIVER DX" });
  document.station.GridSquare = "JN88";
  const items = contestPreflight(document, {}, [], Date.parse("2026-10-27T00:00:00Z"));
  expect(items.find(item => item.label === "UTC / event period")?.status).toBe("ACCEPTED");
  expect(contestPreflight(document, {}, [], Date.parse("2026-10-27T01:00:00Z"))[0].status).toBe("LIMITED");
  expect(items.find(item => item.label === "Sent exchange")?.status).toBe("LIMITED");
  expect(items.find(item => item.label === "Requested output")?.status).toBe("NOT APPLICABLE");
  expect(items.find(item => item.label === "Selected radio")?.status).toBe("UNVERIFIED");
  expect(items.find(item => item.label === "Backup")?.status).toBe("UNVERIFIED");
});

it("keeps report and exchange fields separate and simulates serials without allocating one", () => {
  const document = newContestSetup("OM0RX");
  expect(contestExchangeSample(document)).toBe("Report 599 · exchange 15");
  document.pluginID = "cq_wpx_cw"; document.settings.SentExchange = "#";
  expect(contestExchangeSample(document)).toBe("Report 599 · exchange 001 (simulated serial)");
  expect(document.settings.SentExchange).toBe("#");
});

it("labels unsupported macro control tokens and never executes a preview", () => {
  const document = newContestSetup("OM0RX");
  document.macros = [{ mode: "R", key: "F1", label: "unsafe", template: "{CALL} {TX} {SHELL}" }];
  const message = contestPreflight(document).find(item => item.label === "Message tokens")!;
  expect(message.status).toBe("LIMITED");
  expect(message.detail).toContain("TX, SHELL");
});

it("Practice preview drops credentials and posting without changing the source document", () => {
  const source = newContestSetup("OM0RX");
  Object.assign(source.preferences, { rtcUsername: "private", rtcEnabled: true, autoCQ: true, cwSpeed: 30 });
  source.network.n1mmEnabled = true;
  const copy = practiceContestSetup(source);
  expect(copy.name).toMatch(/^Practice:/);
  expect(copy.preferences.rtcUsername).toBeUndefined();
  expect(copy.preferences).toMatchObject({ rtcEnabled: false, autoCQ: false, cwSpeed: 30 });
  expect(Object.values(copy.network).every(value => value === false)).toBe(true);
  copy.station.Call = "TEST";
  expect(source.station.Call).toBe("OM0RX");
  expect(source.preferences.rtcEnabled).toBe(true);
});

it("offers explicit Practice creation and keeps it separate from real-session create/save", async () => {
  const onCreatePractice = vi.fn(async () => {}), onSave = vi.fn(), onCreate = vi.fn();
  render(<ContestSetupPanel value={newContestSetup("OM0RX")} sessions={[]} activeSessionID="real" catalog={[]}
    onSave={onSave} onCreate={onCreate} onOpen={vi.fn()} onCreatePractice={onCreatePractice} preflightContext={{ practice: false }}/>);
  fireEvent.click(screen.getByRole("button", { name: "Create Practice copy" }));
  await waitFor(() => expect(onCreatePractice).toHaveBeenCalledOnce());
  expect(onCreate).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByText(/Native output and public posting are disabled/)).toBeTruthy();
});
