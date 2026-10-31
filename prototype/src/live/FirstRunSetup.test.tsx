// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FirstRunSetup from "./FirstRunSetup";
afterEach(cleanup);
function identity() {
  fireEvent.change(screen.getByLabelText("Operator call"), { target: { value: "K1ABC" } });
  fireEvent.change(screen.getByLabelText("Station call"), { target: { value: "K1ABC/P" } });
}
it("keeps first run blank, makes hardware skippable, and saves only on explicit Finish", async () => {
  const finish = vi.fn(async () => {}), catalogue = vi.fn();
  render(<FirstRunSetup onFinish={finish} loadModels={catalogue} />);
  expect((screen.getByLabelText("Operator call") as HTMLInputElement).value).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Continue" })); expect(screen.getByRole("alert").textContent).toMatch(/operator call/);
  identity(); fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.getByRole("heading", { name: "Radio (optional)" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Skip radio" }));
  fireEvent.click(screen.getByRole("button", { name: "Skip rotator" }));
  expect(screen.getByText(/Every QSO is saved in xLog/)).toBeTruthy();
  expect(finish).not.toHaveBeenCalled(); expect(catalogue).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
  await waitFor(() => expect(finish).toHaveBeenCalledOnce());
  expect(finish).toHaveBeenCalledWith(expect.objectContaining({ operatorCall: "K1ABC", radio: "skip", rotor: "skip", logbookMode: "local" }));
});
it("retains details and shows actionable save failures while suppressing duplicate Finish", async () => {
  let reject!: (error: Error) => void;
  const finish = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
  render(<FirstRunSetup initialSettings={{ operatorCall: "K1ABC", stationCall: "K1ABC", gridSquare: "FN31" }} onFinish={finish} />);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: "Skip radio" })); fireEvent.click(screen.getByRole("button", { name: "Skip rotator" }));
  fireEvent.change(screen.getByLabelText("Setup logbook mode"), { target: { value: "wavelog" } });
  fireEvent.change(screen.getByLabelText("Wavelog URL"), { target: { value: "https://example.invalid" } });
  fireEvent.change(screen.getByLabelText("Wavelog station ID"), { target: { value: "4" } });
  fireEvent.change(screen.getByLabelText("Wavelog API v2 token (optional)"), { target: { value: "fixture-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Finish setup" }));
  expect((screen.getByRole("button", { name: "Saving setup…" }) as HTMLButtonElement).disabled).toBe(true);
  expect(finish).toHaveBeenCalledOnce(); reject(new Error("Credential vault unavailable. Retry after unlocking it."));
  await screen.findByText(/Credential vault unavailable/);
  expect((screen.getByLabelText("Wavelog URL") as HTMLInputElement).value).toBe("https://example.invalid");
  expect((screen.getByLabelText("Wavelog API v2 token (optional)") as HTMLInputElement).value).toBe("fixture-token");
  expect(screen.getByText(/Synchronization stays off/)).toBeTruthy();
});
