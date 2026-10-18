// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SpotActivationStatus } from "./SpotActivationStatus";
afterEach(cleanup);
const operationId = "00000000-0000-4000-8000-000000000001";
it("does not create a permanent success row and keeps actual progress inline only", () => {
  const view = render(<SpotActivationStatus status={{ operationId, phase: "confirmed", tuneConfirmed: true, rotor: "not_requested" }} reconcile={vi.fn()} />);
  expect(view.container.textContent).toBe("");
  view.rerender(<SpotActivationStatus status={{ operationId, phase: "tuning" }} reconcile={vi.fn()} />); expect(view.container.textContent).toBe("");
  view.rerender(<SpotActivationStatus inline status={{ operationId, phase: "tuning" }} reconcile={vi.fn()} />);
  expect(screen.getByRole("status").tagName).toBe("SPAN"); expect(screen.getByText("Activating report…")).toBeTruthy();
});
it.each([true, false])("never presents uncertain activation confirmation controls (reservation active: %s)", reservationActive => {
  const view = render(<SpotActivationStatus status={{ operationId, phase: "uncertain", tuneConfirmed: false, rotor: "uncertain", reservationActive }} />);
  expect(view.container.textContent).toBe("");
  expect(screen.queryByRole("button")).toBeNull();
});
