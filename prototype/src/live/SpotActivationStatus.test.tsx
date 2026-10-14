// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SpotActivationStatus } from "./SpotActivationStatus";
afterEach(cleanup);
const operationId = "00000000-0000-4000-8000-000000000001";
it("does not create a permanent success row and keeps actual progress inline only", () => {
  const view = render(<SpotActivationStatus status={{ operationId, phase: "confirmed", tuneConfirmed: true, rotor: "not_requested" }} reconcile={vi.fn()} />);
  expect(view.container.textContent).toBe("");
  view.rerender(<SpotActivationStatus status={{ operationId, phase: "tuning" }} reconcile={vi.fn()} />); expect(view.container.textContent).toBe("");
  view.rerender(<SpotActivationStatus inline status={{ operationId, phase: "tuning" }} reconcile={vi.fn()} />);
  expect(screen.getByRole("status").tagName).toBe("SPAN"); expect(screen.getByText("Activating selected report…")).toBeTruthy();
});
it("keeps uncertain/failed cleanup actionable without replaying activation", () => {
  const check = vi.fn();
  render(<SpotActivationStatus status={{ operationId, phase: "confirmed", tuneConfirmed: true, rotor: "not_requested", reservationActive: true }} reconcile={check} />);
  expect(screen.getByText(/cleanup is unconfirmed/)).toBeTruthy(); fireEvent.click(screen.getByRole("button", { name: "Check activation" })); expect(check).toHaveBeenCalledOnce();
});
it("offers explicit receipt-only retirement and honestly permits a new selection once the reservation is closed", () => {
  const retire = vi.fn();
  render(<SpotActivationStatus status={{ operationId, phase: "uncertain", tuneConfirmed: false, rotor: "uncertain", reservationActive: false }} reconcile={vi.fn()} retire={retire} />);
  expect(screen.getByText(/You can select a new report/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Check receipt and retire old activation" }));
  expect(retire).toHaveBeenCalledOnce();
});
