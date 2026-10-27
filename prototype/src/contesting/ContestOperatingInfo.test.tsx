// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContestOperatingInfo, type OperatingInfo } from "./ContestOperatingInfo";
import type { ContestRequest, ContestWorkerResponse } from "./types";

const scope = { sessionID: "session", workspaceGeneration: "workspace", revision: 3 };
const info: OperatingInfo = {
  evaluationUTC: "2026-05-30T01:00:00Z", selectedProfileID: "", profile: null,
  unverifiedReason: "Select an identified rule edition/category; rules are unverified.",
  availableProfiles: [{ id: "wpx-2026-single-op", label: "WPX 2026 Single Operator" }],
  plan: { ruleProfileID: "", note: "" }, qsoCount: 1, invalidTimestampQSOs: 0,
  excludedPeriodOrFutureQSOs: 0, inferredInactivitySeconds: 3600,
  durationNote: "QSO gaps infer inactivity.", allowance: null, offTime: null, bandChanges: null,
};
const reply = (value: OperatingInfo): ContestWorkerResponse<OperatingInfo> => ({ id: "info", ok: true, result: value });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("requests exact log revision and displays unavailable observations without a compliance claim", async () => {
  const request = vi.fn(async () => reply(info)) as unknown as ContestRequest;
  render(<ContestOperatingInfo request={request} scope={scope}/>);
  await screen.findByText(info.unverifiedReason!);
  expect(request).toHaveBeenCalledWith("contest_operating_info", expect.objectContaining({ sessionID: scope.sessionID, workspaceGeneration: scope.workspaceGeneration, expectedRevision: 3, now: expect.any(String) }));
  expect(screen.getByText("Overall compliance unverified. Receiver and transmission activity unknown.")).toBeTruthy();
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(screen.queryByText(/below log limit/)).toBeNull();
});

it("discards an old session reply and hides old allowance immediately on a revision switch", async () => {
  let resolve!: (value: ContestWorkerResponse<OperatingInfo>) => void;
  const pending = new Promise<ContestWorkerResponse<OperatingInfo>>(done => { resolve = done; });
  const request = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(reply({ ...info, unverifiedReason: "New session unverified" })) as unknown as ContestRequest;
  const mounted = render(<ContestOperatingInfo request={request} scope={scope}/>);
  mounted.rerender(<ContestOperatingInfo request={request} scope={{ ...scope, sessionID: "new" }}/>);
  await screen.findByText("New session unverified");
  await act(async () => { resolve(reply({ ...info, unverifiedReason: "Old session" })); await pending; });
  expect(screen.queryByText("Old session")).toBeNull();
});

it("saves deliberate profile adoption and rest notes as plans", async () => {
  const request = vi.fn(async () => reply(info)) as unknown as ContestRequest;
  const save = vi.fn(async () => {});
  render(<ContestOperatingInfo request={request} scope={scope} onPlanSave={save}/>);
  await screen.findByRole("combobox", { name: "Operating rule profile" });
  fireEvent.change(screen.getByRole("combobox", { name: "Operating rule profile" }), { target: { value: "wpx-2026-single-op" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Operating plan note" }), { target: { value: "Rest 02–04 UTC; target 500 QSOs" } });
  fireEvent.click(screen.getByRole("button", { name: "Save operating plan" }));
  await act(async () => {});
  expect(save).toHaveBeenCalledWith({ ruleProfileID: "wpx-2026-single-op", note: "Rest 02–04 UTC; target 500 QSOs" });
  expect(screen.getByText(/Plans and rest notes are intentions/)).toBeTruthy();
});

it("labels clock-hour counts as QSO evidence with unknown ordering and source attribution", async () => {
  const value = { ...info, profile: { label: "WPX 2026 Multi-Single", edition: "2026", sourceURL: "https://cqwpx.com/rules/2026_cqwpx_rules.pdf", interpretationURL: "https://cqwpx.com/rules_faq.htm", startUTC: "2026-05-30T00:00:00Z", endUTCExclusive: "2026-06-01T00:00:00Z", categoryBand: "ALL", scope: "station" },
    bandChanges: { limit: 10, complete: false, unknownOrderOrBandQSOs: 2, hours: [{ hourUTC: "2026-05-31T00:00:00Z", changes: 11, status: "over-log-limit" }] } };
  const request = vi.fn(async () => reply(value)) as unknown as ContestRequest;
  render(<ContestOperatingInfo request={request} scope={scope}/>);
  await screen.findByRole("link", { name: "Official 2026 rules" });
  expect(screen.getByText(/QSO-observed band changes/)).toBeTruthy();
  expect(screen.getByText(/Counts are lower bounds/)).toBeTruthy();
  expect(screen.getByText(/11 \/ 10 · over log limit/)).toBeTruthy();
});

it("keeps a new session plan draft when an old session save finishes late", async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const save = vi.fn(() => pending);
  const request = vi.fn(async () => reply(info)) as unknown as ContestRequest;
  const mounted = render(<ContestOperatingInfo request={request} scope={scope} onPlanSave={save}/>);
  await screen.findByRole("textbox", { name: "Operating plan note" });
  fireEvent.change(screen.getByRole("textbox", { name: "Operating plan note" }), { target: { value: "Original session" } });
  fireEvent.click(screen.getByRole("button", { name: "Save operating plan" }));
  mounted.rerender(<ContestOperatingInfo request={request} scope={{ ...scope, sessionID: "next" }} onPlanSave={save}/>);
  await screen.findByRole("textbox", { name: "Operating plan note" });
  fireEvent.change(screen.getByRole("textbox", { name: "Operating plan note" }), { target: { value: "New session unsaved plan" } });
  await act(async () => { finish(); await pending; });
  expect((screen.getByRole("textbox", { name: "Operating plan note" }) as HTMLTextAreaElement).value).toBe("New session unsaved plan");
});
