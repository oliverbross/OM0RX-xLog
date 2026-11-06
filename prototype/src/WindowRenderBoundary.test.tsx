// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WindowRenderBoundary } from "./WindowRenderBoundary";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("preserves a healthy surface and its state across parent renders", () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  function Counter() {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(value => value + 1)}>Saved view {count}</button>;
  }
  const result = render(<WindowRenderBoundary><Counter /></WindowRenderBoundary>);
  fireEvent.click(screen.getByRole("button", { name: "Saved view 0" }));
  result.rerender(<WindowRenderBoundary><Counter /></WindowRenderBoundary>);
  expect(screen.getByRole("button", { name: "Saved view 1" })).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(report).not.toHaveBeenCalled();
});

it("contains a real render exception with a private, terminal fallback and leaves Escape unconsumed", () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  const attempts = vi.fn();
  const rawError = "private operator path /Users/example/live-log.sqlite and unfinished QSO";
  const failure = new Error(rawError);
  function Broken(): never { attempts(); throw failure; }
  const result = render(<WindowRenderBoundary><Broken /></WindowRenderBoundary>);

  const alert = screen.getByRole("alert");
  expect(screen.getByRole("main", { name: "Window display error" })).toBeTruthy();
  expect(alert.textContent).toContain("Use the application menu to close the window normally");
  expect(alert.textContent).toContain("review any unfinished QSO edits");
  expect(alert.textContent).toContain("UI_RENDER_FAILED");
  expect(alert.textContent?.length).toBeLessThan(500);
  expect(result.container.textContent).not.toContain(rawError);
  // React keeps its existing local diagnostics; only the fallback is sanitized.
  expect(report.mock.calls.flat()).toContain(failure);
  expect(screen.queryByRole("button")).toBeNull();

  const countAfterFailure = attempts.mock.calls.length;
  result.rerender(<WindowRenderBoundary><div>Do not remount a failed surface</div></WindowRenderBoundary>);
  expect(screen.getByRole("alert")).toBe(alert);
  expect(screen.queryByText("Do not remount a failed surface")).toBeNull();
  expect(attempts).toHaveBeenCalledTimes(countAfterFailure);

  const observedEscape = vi.fn(), observer = (event: KeyboardEvent) => {
    if (event.key === "Escape") observedEscape(event.defaultPrevented);
  };
  window.addEventListener("keydown", observer);
  try {
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    alert.dispatchEvent(escape);
    expect(observedEscape).toHaveBeenCalledWith(false);
    expect(escape.defaultPrevented).toBe(false);
  } finally { window.removeEventListener("keydown", observer); }
});

it("contains a failure after mount and allows existing child cleanup to run", () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  const release = vi.fn();
  function OwnedSurface() {
    const [failed, setFailed] = useState(false);
    useEffect(() => () => { release(); }, []);
    if (failed) throw new Error("private pending operation");
    return <button onClick={() => setFailed(true)}>Trigger display failure</button>;
  }
  render(<WindowRenderBoundary><OwnedSurface /></WindowRenderBoundary>);
  expect(release).not.toHaveBeenCalled();
  act(() => fireEvent.click(screen.getByRole("button", { name: "Trigger display failure" })));
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(release).toHaveBeenCalledOnce();
  expect(report).toHaveBeenCalled();
});
