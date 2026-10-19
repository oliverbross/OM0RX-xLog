// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DetachedContestCallHistorySurface } from "./DetachedContestCallHistorySurface";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

const context = {
  operatingContext: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sessionID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  workspaceGeneration: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, "", `/?scope=contesting&view=call-history&operatingContext=${context.operatingContext}&sessionID=${context.sessionID}&workspaceGeneration=${context.workspaceGeneration}`);
  native.invoke.mockImplementation(async (command: string, args: Record<string, unknown>) => {
    if (command === "contest_history_manager_request") return { id: "request", ok: true, result: {
      dataset: null, pendingPreview: null, unavailableReason: "not_imported",
      activation: { state: "not_imported", generation: null, digest: null, rowCount: null, message: null },
    } };
    if (command === "contest_history_preview") return null;
    throw new Error(`Unexpected native command ${command}: ${JSON.stringify(args)}`);
  });
});

afterEach(() => cleanup());

it("binds one status request and the private picker to the detached contest context without a refresh loop", async () => {
  render(<DetachedContestCallHistorySurface />);
  await screen.findByText("No local call-history file imported.");
  await waitFor(() => expect(native.invoke.mock.calls.filter(([command]) => command === "contest_history_manager_request")).toHaveLength(1));
  expect(native.invoke).toHaveBeenCalledWith("contest_history_manager_request", {
    ...context, method: "contest_history_status", params: {},
  });

  fireEvent.click(screen.getByRole("button", { name: "Import local file" }));
  await waitFor(() => expect(native.invoke).toHaveBeenCalledWith("contest_history_preview", context));
  expect(native.invoke.mock.calls.filter(([command]) => command === "contest_history_manager_request")).toHaveLength(1);
});
