// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ContestQRZDetailsSurface, fittedQRZDetailsHeight } from "./DetachedContestQRZDetailsSurface";

const native = vi.hoisted(() => ({ invoke: vi.fn(), listener: undefined as undefined | (() => void) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_name: string, listener: () => void) => {
  native.listener = listener; return () => { native.listener = undefined; };
}) }));
vi.mock("@tauri-apps/api/dpi", () => ({ LogicalSize: class { constructor(public width: number, public height: number) {} } }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({
  innerSize: async () => ({ width: 520, height: 420, toLogical: () => ({ width: 520, height: 420 }) }),
  outerSize: async () => ({ width: 520, height: 450 }), scaleFactor: async () => 1, setSize: vi.fn(),
}) }));

const search = "?view=qrz-details&scope=contesting&operatingContext=10000000-0000-4000-8000-000000000001&sessionID=10000000-0000-4000-8000-000000000002&workspaceGeneration=10000000-0000-4000-8000-000000000003";
const projection = (callsign: string, revision: number) => ({
  operatingContext: "10000000-0000-4000-8000-000000000001", scope: "contesting", sessionID: "10000000-0000-4000-8000-000000000002",
  workspaceGeneration: "10000000-0000-4000-8000-000000000003", panelID: "qrz-details", projectionRevision: revision, receipts: [],
  projection: { schemaVersion: 2, status: "ready", session: { name: "CQ WW", ruleName: "CQ WW", mode: "CW" },
    draft: { draftID: "10000000-0000-4000-8000-000000000004", revision, callsign, sentReport: "599", receivedReport: "599", receivedFields: [], frequencyHz: 14_025_000,
      frequencyText: "14025000", frequencyError: "", band: "20m", mode: "CW", dupe: { state: "clear", reason: "" }, validation: { errors: [], warnings: [] }, reservedSerial: null },
    descriptor: { bands: ["20m"], modes: ["CW"], sentFields: [], serial: { requirement: "none", allocatedFieldID: null, reservedSerial: null } },
    operator: null, busy: false, dirty: false, uncertain: false },
});

beforeEach(() => { native.invoke.mockReset(); native.listener = undefined; });

it("debounces lookup, renders useful fields, and never exposes an entry control", async () => {
  native.invoke.mockImplementation(async (command: string) => command === "contest_surface_snapshot" ? projection("EA7EU", 1) : {});
  const lookup = vi.fn(async () => ({ call: "EA7EU", source: "QRZ XML", name: "Operator", country: "Spain", gridSquare: "IM67AA", dxcc: 281,
    qth: "Seville", continent: "EU", ituZone: 37, cqZone: 14, email: "operator@example.invalid", qslManager: "EA0TEST", lookup_warning: "Extra warning" }));
  const view = render(<ContestQRZDetailsSurface search={search} lookup={lookup}/>);
  await act(async () => { await Promise.resolve(); });
  expect(lookup).not.toHaveBeenCalled();
  await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Operator")).toBeTruthy();
  expect([...view.container.querySelectorAll("dt")].map(node => node.textContent)).toEqual([
    "Name", "Country", "QTH", "Grid", "Continent", "ITU zone", "CQ zone",
  ]);
  for (const detail of ["Spain", "Seville", "IM67AA", "EU", "37", "14"]) expect(screen.getByText(detail)).toBeTruthy();
  for (const omitted of ["QRZ XML", "281", "operator@example.invalid", "EA0TEST", "Extra warning", "DXCC", "QSL manager", "Email"])
    expect(screen.queryByText(omitted)).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("discards an old lookup when the contest draft callsign changes", async () => {
  let current = projection("EA7EU", 1), resolveOld!: (value: Record<string, unknown>) => void;
  native.invoke.mockImplementation(async (command: string) => command === "contest_surface_snapshot" ? current : {});
  const lookup = vi.fn((_: unknown, call: string) => call === "EA7EU"
    ? new Promise<Record<string, unknown>>(resolve => { resolveOld = resolve; })
    : Promise.resolve({ call: "OM0RX", name: "Current operator", country: "Slovakia" }));
  render(<ContestQRZDetailsSurface search={search} lookup={lookup}/>);
  await waitFor(() => expect(lookup).toHaveBeenCalledWith(expect.anything(), "EA7EU"));
  current = projection("OM0RX", 2);
  await act(async () => { native.listener?.(); });
  expect((await screen.findAllByText("Current operator")).length).toBeGreaterThan(0);
  await act(async () => resolveOld({ call: "EA7EU", name: "Stale operator" }));
  expect(screen.queryByText("Stale operator")).toBeNull();
});

it("fits content to the available screen height", () => {
  expect(fittedQRZDetailsHeight(300, 900, 1, 30)).toBe(354);
  expect(fittedQRZDetailsHeight(1200, 700, 1, 30)).toBe(636);
  expect(fittedQRZDetailsHeight(300, 900, 1.5, 30)).toBe(516);
  expect(fittedQRZDetailsHeight(300, 1_400, 2, 30)).toBe(678);
});
