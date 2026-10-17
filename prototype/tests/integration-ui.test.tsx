// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { spots } from "../src/model";
const request = vi.hoisted(() => vi.fn());
vi.mock("../src/Map", () => ({ default: () => <div aria-label="Offline fixture" /> }));
vi.mock("../src/acceptance", () => ({ startAcceptance: () => {} }));
vi.mock("../src/worker", () => ({ desktop: true, workerRequest: request, openMonitor: vi.fn() }));
import App from "../src/App";
const classified = (worked = false) => ({ id: "fixture", ok: true, result: {
  schema_version: 1, history_scope: "synthetic_session", station_io: false,
  spots: spots.map(s => ({ id: s.id, call: s.call, frequency_hz: Math.round(s.mhz * 1e6), band: s.band, mode: s.mode,
    call_status: worked ? "Worked" : "New Call", dxcc_status: worked ? "Worked" : "ATNO", score: 85 })),
} });
beforeEach(() => {
  request.mockReset();
  vi.stubGlobal("BroadcastChannel", class { onmessage = null; postMessage() {} close() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("updates classifications after logging and ignores a superseded response", async () => {
  let resolveFirst!: (value: ReturnType<typeof classified>) => void;
  let batches = 0;
  request.mockImplementation((method: string) => {
    if (method !== "cluster_classify") return Promise.resolve({ id: "health", ok: true, result: {} });
    batches++;
    return batches === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : Promise.resolve(classified(true));
  });
  render(<App />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "DX Cluster" }));
  await user.click(screen.getByRole("button", { name: "W1AW" }));
  fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(batches).toBe(2));
  await user.click(screen.getByRole("button", { name: "DX Cluster" }));
  await waitFor(() => expect(screen.getAllByText("W")).toHaveLength(9));
  resolveFirst(classified(false));
  await waitFor(() => expect(screen.queryAllByText("ATNO")).toHaveLength(0));
  expect(screen.getByRole("status").textContent).toContain("1 synthetic session QSOs");
});
it("does not present fixture labels as native results when worker fails and allows retry", async () => {
  let attempts = 0;
  request.mockImplementation((method: string) => method === "cluster_classify"
    ? (++attempts === 1 ? Promise.reject(new Error("unavailable")) : Promise.resolve(classified()))
    : Promise.resolve({ id: "health", ok: true, result: {} }));
  render(<App />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "DX Cluster" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Classification unavailable"));
  expect(screen.queryAllByText("ATNO")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Refresh classification" }));
  await waitFor(() => expect(screen.getAllByText("ATNO")).toHaveLength(9));
});
