// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CWCallsignAction, parseCWCallsignOutcome } from "./CWCallsignAction";
import { cwDecodeTrackFixture } from "./cwDecode.fixtures";
beforeEach(() => sessionStorage.clear());
afterEach(cleanup);
function fixture() {
  const snapshot = cwDecodeTrackFixture(), signal = snapshot.tracks[0];
  snapshot.featureEnabled = true; snapshot.operatingModule = "normal_logging";
  snapshot.operatingContext = "a0000000-0000-4000-8000-000000000001";
  signal.selection = { callsign: "K1ABC", reference: { sessionID: signal.descriptor.sessionID, sourceID: signal.sourceID,
    streamToken: signal.descriptor.streamToken, epoch: signal.descriptor.epoch, trackID: signal.trackID, revision: signal.revision,
    selectionID: "60000000-0000-0000-0000-000000000001" },
    activation: { sourceEpoch: "80000000-0000-0000-0000-000000000001", spotVersion: "90000000-0000-0000-0000-000000000001" } };
  return { snapshot, signal };
}
it.each(["normal_logging", "contesting"] as const)("mounts passively and sends only native identities in %s on one explicit click", async module => {
  const value = fixture(); value.snapshot.operatingModule = module; let finish!: (reply: unknown) => void;
  const request = vi.fn((_params: Record<string, unknown>) => new Promise(resolve => { finish = resolve; }));
  render(<CWCallsignAction {...value} request={request} />); expect(request).not.toHaveBeenCalled();
  const button = screen.getByRole("button", { name: "Use callsign K1ABC" });
  fireEvent.click(button); fireEvent.click(button);
  expect(request).toHaveBeenCalledTimes(1);
  const params = request.mock.calls[0][0] as Record<string, unknown>;
  expect(params).toEqual({ action: "apply", operationId: expect.any(String), sourceEpoch: value.signal.selection!.activation!.sourceEpoch,
    spotId: value.signal.trackID, spotVersion: value.signal.selection!.activation!.spotVersion,
    operatingModule:module,operatingContext:value.snapshot.operatingContext });
  finish({ operationId: params.operationId, phase: "confirmed", reservationActive: false });
  await screen.findByText("Callsign loaded into the logging entry. Frequency and mode are retained.");
  expect(sessionStorage.length).toBe(0);
});
it("retains lost acknowledgement through remount and reconciles the original identity without applying again", async () => {
  const value = fixture();
  const request = vi.fn(async (params: Record<string, unknown>) => {
    if (params.action === "apply") throw new Error("Reply lost");
    return { operationId: params.operationId, phase: "confirmed", reservationActive: false };
  });
  const first = render(<CWCallsignAction {...value} request={request} />);
  fireEvent.click(screen.getByRole("button", { name: "Use callsign K1ABC" })); await screen.findByText("Reply lost");
  const operationId = request.mock.calls[0][0].operationId; first.unmount();
  render(<CWCallsignAction {...value} request={request} />);
  expect((screen.getByRole("button", { name: "Use callsign K1ABC" }) as HTMLButtonElement).disabled).toBe(true);
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Check original action" }));
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(request.mock.calls[1][0]).toEqual({ action: "reconcile", operationId });
  await screen.findByText("Callsign loaded into the logging entry. Frequency and mode are retained.");
});
it("does not unlock after an uncorrelated or uncertain result", async () => {
  const value = fixture(); const request = vi.fn(async (_params: Record<string, unknown>): Promise<unknown> => ({ operationId: crypto.randomUUID(), phase: "confirmed", reservationActive: false }));
  render(<CWCallsignAction {...value} request={request} />);
  fireEvent.click(screen.getByRole("button", { name: "Use callsign K1ABC" })); await screen.findByRole("alert");
  expect((screen.getByRole("button", { name: "Use callsign K1ABC" }) as HTMLButtonElement).disabled).toBe(true);
  const operationId = request.mock.calls[0][0].operationId;
  request.mockImplementation(async () => ({ operationId, phase: "uncertain", reservationActive: false }));
  fireEvent.click(screen.getByRole("button", { name: "Check original action" }));
  await screen.findByText("Review Main Logging and check the original action. Its outcome is uncertain.");
  expect((screen.getByRole("button", { name: "Use callsign K1ABC" }) as HTMLButtonElement).disabled).toBe(true);
});
it.each(["disabled", "missing-module", "missing-context", "ambiguous"])("blocks %s selections", condition => {
  const value = fixture();
  if (condition === "disabled") value.snapshot.featureEnabled = false;
  if (condition === "missing-module") delete value.snapshot.operatingModule;
  if (condition === "missing-context") delete value.snapshot.operatingContext;
  if (condition === "ambiguous") value.signal.ambiguous = true;
  const request = vi.fn(); render(<CWCallsignAction {...value} request={request} />);
  fireEvent.click(screen.getByRole("button", { name: "Use callsign K1ABC" })); expect(request).not.toHaveBeenCalled();
});
it("rejects extra authority or draft data in replies", () => {
  const operation = crypto.randomUUID();
  expect(() => parseCWCallsignOutcome({ operationId: operation, phase: "confirmed", reservationActive: false, draft: {} }, operation)).toThrow();
  expect(() => parseCWCallsignOutcome({ operationId: operation, phase: "tuning", reservationActive: true }, operation)).toThrow();
});
