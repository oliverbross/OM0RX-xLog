// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DetachedLogbookSurface } from "./DetachedLogbookSurface";

const api = vi.hoisted(() => ({ read: vi.fn(), contact: vi.fn(), protect: vi.fn(), stop: vi.fn() }));
vi.mock("../worker", () => ({ workerRequest: api.read }));
vi.mock("./logbookContactTransport", () => ({ requestLogbookContact: api.contact }));
vi.mock("./logbookWindows", () => ({ connectLogbookChanges: () => api.stop, protectLogbookClose: api.protect }));
vi.mock("./useSpotEditor", () => ({ nativeSpotEditor: () => false, useSpotEditor: () => ({}) }));
afterEach(() => { cleanup(); localStorage.clear(); vi.resetAllMocks(); });

it("opens at the logbook task toolbar without window navigation and retains native close protection", async () => {
  api.read.mockResolvedValue({ result: { qsos: [], total: 0, offset: 0, limit: 20 } });
  api.protect.mockReturnValue(() => {});
  const view = render(<DetachedLogbookSurface />);
  expect(await screen.findByRole("button", { name: /^Search$/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Show Desk|Dock back|Close window/ })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Logbook" })).toBeNull();
  expect(api.protect).toHaveBeenCalledOnce();
  await waitFor(() => expect(api.protect.mock.calls[0][0]()).toBe(false));
  expect(api.contact).not.toHaveBeenCalled();
  view.unmount(); expect(api.stop).toHaveBeenCalledOnce();
});
