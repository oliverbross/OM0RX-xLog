// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CWTuneAction, parseCWTuneOutcome } from "./CWTuneAction";
import { cwDecodeTrackFixture } from "./cwDecode.fixtures";
beforeEach(() => sessionStorage.clear()); afterEach(cleanup);
function fixture() {
  const snapshot = cwDecodeTrackFixture(), signal = snapshot.tracks[0];
  snapshot.featureEnabled = true; snapshot.activeRadioID = "radio1"; snapshot.operatingModule = "normal_logging";
  snapshot.operatingContext = crypto.randomUUID(); signal.descriptor.mappingQualified = true; signal.frequencyHz = 14025600;
  signal.controlActivation = { sourceEpoch: crypto.randomUUID(), spotVersion: crypto.randomUUID() };
  // Tuning a qualified carrier requires no callsign hypothesis.
  delete signal.selection;
  return { snapshot, signal };
}
it.each(["normal_logging", "contesting"] as const)("tunes a call-less carrier only on an explicit identity-only click in %s", async module => {
  const value = fixture(); value.snapshot.operatingModule = module;
  const request = vi.fn(async (params: Record<string, unknown>) => ({ operationId: params.operationId, radioID: "radio1", status: "confirmed" }));
  render(<CWTuneAction {...value} request={request} />); expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Tune Radio 1 to 14.025600 MHz CW" }));
  await screen.findByText("CW tune confirmed by the radio. The logging entry is retained.");
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toEqual({ action: "apply", operationId: expect.any(String), sourceEpoch: value.signal.controlActivation!.sourceEpoch,
    spotId: value.signal.trackID, spotVersion: value.signal.controlActivation!.spotVersion, operatingModule: module, operatingContext: value.snapshot.operatingContext });
  expect(sessionStorage.length).toBe(0);
});
it("retains a lost reply across remount and checks only the original operation", async () => {
  const value = fixture(); const request = vi.fn(async (params: Record<string, unknown>) => {
    if (params.action === "apply") throw new Error("Reply lost");
    return { operationId: params.operationId, radioID: params.radioID, status: "confirmed" };
  });
  const view = render(<CWTuneAction {...value} request={request} />);
  const button = screen.getByRole("button", { name: /^Tune Radio/ }); fireEvent.click(button); fireEvent.click(button);
  await screen.findByText("Reply lost"); expect(request).toHaveBeenCalledTimes(1);
  const operationId = request.mock.calls[0][0].operationId; view.unmount();
  render(<CWTuneAction {...value} request={request} />); expect(request).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("button", { name: /^Tune Radio/ }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Check original tune" }));
  await screen.findByText("CW tune confirmed by the radio. The logging entry is retained.");
  expect(request.mock.calls[1][0]).toEqual({ action: "status", operationId, radioID: "radio1" });
});
it.each(["pending", "unknown", "missing"])("holds %s outcomes and never retries", async status => {
  const value = fixture(); const request = vi.fn(async (params: Record<string, unknown>) => ({ operationId: params.operationId, radioID: "radio1", status }));
  render(<CWTuneAction {...value} request={request} />);
  fireEvent.click(screen.getByRole("button", { name: /^Tune Radio/ }));
  await screen.findByText(/The original tune remains unverified/);
  expect((screen.getByRole("button", { name: /^Tune Radio/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(request).toHaveBeenCalledTimes(1); expect(sessionStorage.length).toBe(1);
});
it.each(["inactive", "unqualified", "muted", "ambiguous", "replay", "disabled", "context"])("blocks %s signals without an action", reason => {
  const value = fixture();
  if (reason === "inactive") value.snapshot.activeRadioID = "radio2";
  if (reason === "unqualified") value.signal.descriptor.mappingQualified = false;
  if (reason === "muted") value.signal.muted = true;
  if (reason === "ambiguous") value.signal.ambiguous = true;
  if (reason === "replay") value.signal.descriptor.replay = true;
  if (reason === "disabled") value.snapshot.featureEnabled = false;
  if (reason === "context") delete value.snapshot.operatingContext;
  const request = vi.fn();render(<CWTuneAction {...value} request={request} />);
  fireEvent.click(screen.getByRole("button", { name: /^Tune Radio/ }));expect(request).not.toHaveBeenCalled();
});
it("refuses malformed retained intent and acknowledgements", () => {
  sessionStorage.setItem("xlog.cw.pending-tune", "bad");const value = fixture();const request = vi.fn();
  render(<CWTuneAction {...value} request={request} />);fireEvent.click(screen.getByRole("button", { name: /^Tune Radio/ }));expect(request).not.toHaveBeenCalled();
  const pending = { operationId: crypto.randomUUID(), radioID: "radio1" as const };
  expect(() => parseCWTuneOutcome({ ...pending, status: "confirmed", frequencyHz: 14025000 }, pending)).toThrow();
  expect(() => parseCWTuneOutcome({ ...pending, radioID: "radio2", status: "confirmed" }, pending)).toThrow();
  expect(parseCWTuneOutcome({ operationId: pending.operationId, status: "not_admitted" }, pending).status).toBe("not_admitted");
});
