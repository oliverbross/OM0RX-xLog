// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { useQSOLoggedToast } from "./QSOLoggedToast";

function Feedback() {
  const feedback = useQSOLoggedToast();
  return <main className="qso-feedback-area">{feedback.toast}<button onClick={feedback.show}>Save</button><p role="alert">Sync acknowledgement unavailable</p><section>Logbook</section></main>;
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("announces one success for 1 second while persistent errors remain", () => {
  vi.useFakeTimers(); render(<Feedback />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getByRole("status").textContent).toBe("QSO logged");
  expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  act(() => vi.advanceTimersByTime(999)); expect(screen.getByText("QSO logged")).toBeTruthy();
  act(() => vi.advanceTimersByTime(1)); expect(screen.queryByText("QSO logged")).toBeNull();
  expect(screen.getByRole("alert").textContent).toBe("Sync acknowledgement unavailable");
});

it("restarts the deadline on rapid saves without duplicate feedback or stale dismissal", () => {
  vi.useFakeTimers(); render(<Feedback />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  act(() => vi.advanceTimersByTime(700));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(screen.getAllByText("QSO logged")).toHaveLength(1);
  act(() => vi.advanceTimersByTime(300)); expect(screen.getByText("QSO logged")).toBeTruthy();
  act(() => vi.advanceTimersByTime(699)); expect(screen.getByText("QSO logged")).toBeTruthy();
  act(() => vi.advanceTimersByTime(1)); expect(screen.queryByText("QSO logged")).toBeNull();
});

it("cleans the deadline on unmount", () => {
  vi.useFakeTimers(); const view = render(<Feedback />);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(vi.getTimerCount()).toBe(1);
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
});

it("uses an absolute overlay with no layout slot or motion", () => {
  const css = readFileSync("src/live/QSOLoggedToast.css", "utf8");
  expect(css).toContain("position: absolute");
  expect(css).toContain("pointer-events: none");
  expect(css).not.toMatch(/(?:^|[;{])\s*(?:animation|transition)\s*:/);
  render(<Feedback />);
  expect(document.querySelector(".qso-logged-toast")).toBeNull();
  expect(document.querySelector("main")!.children).toHaveLength(3);
});
