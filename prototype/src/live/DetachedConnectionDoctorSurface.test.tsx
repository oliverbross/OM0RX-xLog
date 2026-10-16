// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
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
  expect(screen.queryByRole("button")).toBeNull(); expect(screen.queryByRole("textbox")).toBeNull();
  expect(container.textContent).not.toContain("14.074"); expect(container.textContent).not.toContain("PRIVATE-ENDPOINT-TOKEN");
  expect(native.invoke.mock.calls).toEqual([["connection_doctor_snapshot"]]);
  unmount(); expect(native.stop).toHaveBeenCalledTimes(2);
});

it("is the exact native Connection Doctor route", async () => {
  expect(await loadWindowSurface("?view=connection-doctor")).toBe(DetachedConnectionDoctorSurface);
});
