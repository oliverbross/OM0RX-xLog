// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DetachedConnectionDoctorSurface } from "./DetachedConnectionDoctorSurface";
import { loadWindowSurface } from "../windowSurface";
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), stop: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
const preview = { schemaVersion: 1, evidence: "retained-worker-state-only", provider: "direct_tci", configuration: "unknown", transport: "ready", freshness: "fresh", readOnly: true,
  advertisedCapabilities: ["observe"], checks: [
    { stage: "provider", status: "passed", reason: "providerRecognized" }, { stage: "configuration", status: "unknown", reason: "configurationUnknown" },
    { stage: "connection", status: "passed", reason: "connected" }, { stage: "freshness", status: "passed", reason: "observationFresh" },
    { stage: "capabilities", status: "passed", reason: "readOnly" },
  ] };
beforeEach(() => { vi.useFakeTimers(); vi.resetAllMocks(); native.invoke.mockResolvedValue(preview); native.listen.mockResolvedValue(native.stop); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("starts with the diagnostic content, remains read only and shows no source values", async () => {
  const { container, unmount } = render(<DetachedConnectionDoctorSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(container.firstElementChild?.classList.contains("detached-task-app")).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("Direct TCI");
  expect(screen.getByRole("heading", { name: "Diagnostic stages" })).toBeTruthy();
  expect(screen.getByText("Configuration not inspected")).toBeTruthy(); expect(screen.getByText("Read only")).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(1); expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByRole("button", { name: "Export redacted report…" })).toBeTruthy();
  expect(container.textContent).not.toContain("14.074"); expect(container.textContent).not.toContain("PRIVATE-ENDPOINT-TOKEN");
  expect(native.invoke.mock.calls).toEqual([["connection_doctor_snapshot"]]);
  unmount(); expect(native.stop).toHaveBeenCalledTimes(2);
});

it("exports only on click using the displayed allowlist, fences repeat clicks and reports cancellation", async () => {
  let finish!: (saved: boolean) => void;
  render(<DetachedConnectionDoctorSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(native.invoke.mock.calls).toEqual([["connection_doctor_snapshot"]]);
  native.invoke.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole("button", { name: "Export redacted report…" }));
  fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
  expect(native.invoke.mock.calls).toEqual([["connection_doctor_snapshot"], ["connection_doctor_export", { preview }]]);
  await act(async () => finish(false));
  expect(screen.getByText("Export cancelled. No report saved.")).toBeTruthy();
  expect(native.invoke).toHaveBeenCalledTimes(2);
});

it("reports save success and sanitizes native failures without exposing paths or errors", async () => {
  render(<DetachedConnectionDoctorSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  native.invoke.mockResolvedValueOnce(true);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Export redacted report…" })));
  expect(screen.getByText("Redacted report saved.")).toBeTruthy();
  native.invoke.mockRejectedValueOnce(new Error("PRIVATE-ENDPOINT-TOKEN /private/operator/report.json"));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Export redacted report…" })));
  expect(screen.getByText("Redacted report could not be saved. Try again.")).toBeTruthy();
  expect(document.body.textContent).not.toContain("PRIVATE-ENDPOINT-TOKEN");
  expect(document.body.textContent).not.toContain("/private/operator");
  expect(native.invoke.mock.calls.map(call => call[0])).toEqual(["connection_doctor_snapshot", "connection_doctor_export", "connection_doctor_export"]);
});

it("has no export action until a verified projection is available", async () => {
  native.invoke.mockResolvedValue({ ...preview, endpoint: "PRIVATE-ENDPOINT-TOKEN" });
  render(<DetachedConnectionDoctorSurface />); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.queryByRole("button")).toBeNull();
  expect(native.invoke.mock.calls).toEqual([["connection_doctor_snapshot"]]);
});

it("is the exact native Connection Doctor route", async () => {
  expect(await loadWindowSurface("?view=connection-doctor")).toBe(DetachedConnectionDoctorSurface);
});
