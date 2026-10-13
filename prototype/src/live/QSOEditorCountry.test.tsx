// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import QSOEditor from "./QSOEditor";

const changes = vi.hoisted(() => ({ wake: undefined as (() => void) | undefined, stop: vi.fn() }));
vi.mock("./logbookWindows", () => ({ connectLogbookChanges: (wake: () => void) => { changes.wake = wake; return changes.stop; } }));
beforeEach(() => { changes.wake = undefined; changes.stop.mockClear(); });
afterEach(cleanup);
const lookup = { call: "EA7EU", country: "Spain", dxcc: 281, isNewCall: true };
const history = { call: "EA7EU", adif: 281, matrix: [], dxcc_contact_count: 12, dxcc_confirmed_count: 2 };
const props = () => ({ draft: { id: "synthetic", call: "EA7EU", start: "2026-10-14T12:00:00Z", frequencyHz: 14025000,
  band: "20m", mode: "CW", rstSent: "599", rstReceived: "599" }, setDraft: vi.fn(), save: vi.fn(), clear: vi.fn(),
  busy: false, lookup, previous: [], follow: false, setFollow: vi.fn() });
const identity = (container: HTMLElement) => container.querySelector(".qso-country-identity")!;

it.each([[12, 2, "confirmed", "Confirmed"], [12, 0, "worked", "Worked"], [0, 0, "new", "New DXCC"]] as const)(
  "shows matching DXCC %s/%s as %s above UTC without editing the draft", async (worked, confirmed, status, label) => {
    const p = props(), request = vi.fn(async (method: string) => method === "logbook_matrix" ? { cells: [] }
      : { history: { ...history, dxcc_contact_count: worked, dxcc_confirmed_count: confirmed } });
    const { container } = render(<QSOEditor {...p} request={request} />);
    await waitFor(() => expect(identity(container).classList.contains(`qso-country-${status}`)).toBe(true));
    expect(identity(container).getAttribute("aria-label")).toBe(`Spain · DXCC 281: ${label}`);
    expect(identity(container).nextElementSibling?.className).toBe("qso-utc");
    expect(identity(container).closest(".qso-primary")).toBeNull();
    expect(p.setDraft).not.toHaveBeenCalled();
  });

it("keeps pending and failed DXCC reads neutral, irrespective of previous-call QSOs", async () => {
  let reject!: (reason: Error) => void;
  const request = vi.fn((method: string) => method === "logbook_matrix" ? Promise.resolve({ cells: [] })
    : new Promise((_resolve, fail) => { reject = fail; }));
  const { container } = render(<QSOEditor {...props()} previous={[{ call: "EA7EU", qslReceived: "Y", dxcc: 281 }]} request={request} />);
  expect(identity(container).classList.contains("qso-country-neutral")).toBe(true);
  await act(async () => reject(new Error("Synthetic history unavailable")));
  await screen.findByText("Could not read country history.");
  expect(identity(container).getAttribute("aria-label")).toBe("Spain · DXCC 281: History unresolved");
});

it.each([{ ...history, call: "OTHER" }, { ...history, adif: 223 }, { ...history, dxcc_contact_count: undefined }])(
  "does not colour a mismatched/incomplete response as a new entity: %#", async evidence => {
    const request = vi.fn(async (method: string) => method === "logbook_matrix" ? { cells: [] } : { history: evidence });
    const { container } = render(<QSOEditor {...props()} request={request} />);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(identity(container).classList.contains("qso-country-neutral")).toBe(true);
  });

it("removes old country/classification immediately when callsign changes, rejecting its delayed history", async () => {
  let finish!: (value: unknown) => void;
  const request = vi.fn((method: string) => method === "logbook_matrix" ? Promise.resolve({ cells: [] }) : new Promise(resolve => { finish = resolve; }));
  const p = props(), view = render(<QSOEditor {...p} request={request} />);
  view.rerender(<QSOEditor {...p} draft={{ ...p.draft, call: "OM0RX" }} request={request} />);
  expect(identity(view.container).textContent).toBe("Country unresolved");
  await act(async () => finish({ history: { ...history, dxcc_contact_count: 0, dxcc_confirmed_count: 0 } }));
  expect(identity(view.container).classList.contains("qso-country-neutral")).toBe(true);
  expect(identity(view.container).textContent).not.toContain("Spain");
});

it("retires accepted history immediately when the matching lookup changes DXCC", async () => {
  const request = vi.fn((method: string, params?: Record<string, any>) => method === "logbook_matrix" ? Promise.resolve({ cells: [] })
    : params?.adif === 281 ? Promise.resolve({ history }) : new Promise(() => {}));
  const p = props(), view = render(<QSOEditor {...p} request={request} radioControls={false} />);
  await waitFor(() => expect(identity(view.container).classList.contains("qso-country-confirmed")).toBe(true));
  view.rerender(<QSOEditor {...p} lookup={{ ...lookup, country: "England", dxcc: 223 }} request={request} radioControls={false} />);
  expect(identity(view.container).classList.contains("qso-country-neutral")).toBe(true);
  expect(identity(view.container).textContent).toBe("England · DXCC 223");
});

it.each([[0, 0, "new", 1, 0, "worked"], [12, 0, "worked", 12, 2, "confirmed"]] as const)(
  "reloads same-call aggregate history %s/%s (%s) to %s/%s (%s) on a local log/sync wake", async (startWorked, startConfirmed, startStatus, nextWorked, nextConfirmed, nextStatus) => {
  let worked: number = startWorked, confirmed: number = startConfirmed;
  const request = vi.fn(async (method: string) => method === "logbook_matrix" ? { cells: [] }
    : { history: { ...history, dxcc_contact_count: worked, dxcc_confirmed_count: confirmed } });
  const view = render(<QSOEditor {...props()} request={request} radioControls={false} />);
  await waitFor(() => expect(identity(view.container).classList.contains(`qso-country-${startStatus}`)).toBe(true));
  worked = nextWorked; confirmed = nextConfirmed;
  act(() => changes.wake!());
  await waitFor(() => expect(identity(view.container).classList.contains(`qso-country-${nextStatus}`)).toBe(true));
  expect(request.mock.calls.filter(([method]) => method === "cluster_history")).toHaveLength(2);
  view.unmount();
  expect(changes.stop).toHaveBeenCalledOnce();
});

it("rejects a pre-wake same-call reply before a refreshed read has finished", async () => {
  const replies: Array<(value: unknown) => void> = [];
  const request = vi.fn((method: string) => method === "logbook_matrix" ? Promise.resolve({ cells: [] })
    : new Promise(resolve => replies.push(resolve)));
  const view = render(<QSOEditor {...props()} request={request} />);
  expect(replies).toHaveLength(1);
  act(() => changes.wake!());
  expect(replies).toHaveLength(2);
  await act(async () => replies[0]({ history: { ...history, dxcc_contact_count: 0, dxcc_confirmed_count: 0 } }));
  expect(identity(view.container).classList.contains("qso-country-neutral")).toBe(true);
  await act(async () => replies[1]({ history }));
  expect(identity(view.container).classList.contains("qso-country-confirmed")).toBe(true);
});
