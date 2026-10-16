// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { verifyWorkspaceMenuRoutes } from "./workspaceMenuAcceptance";
import { workspaceMenuScreens, workspaceScreens } from "./live/workspaceNavigation";
import ServiceSettings from "./live/ServiceSettings";

afterEach(cleanup);
async function fixture(changed?: "settings" | "draft") {
  const settings = { logbookMode: "local", stationCall: "TEST1", automaticSync: false };
  const draft = { generation: "fixture", revision: 3, qso: { id: "draft", call: "TEST1", comment: "Retain text" } };
  let settingsReads = 0, draftReads = 0;
  const worker = vi.fn(async (method: string) => {
    if (method === "settings_load") return { result: { settings: changed === "settings" && ++settingsReads > 1
      ? { ...settings, automaticSync: true } : structuredClone(settings) } };
    if (method === "logbook_operator_draft") return { result: { draft: changed === "draft" && ++draftReads > 1
      ? { ...draft, qso: { ...draft.qso, comment: "Unexpected change" } } : structuredClone(draft) } };
    throw new Error(`Unexpected acceptance authority ${method}`);
  });
  const settingsRequest = vi.fn(async (_method: string, _params?: Record<string, unknown>) => ({}));
  const view = render(h("main"));
  const navigate = vi.fn(async (name: string) => {
    // Mirror acceptance_screen's strict actual-menu scope: hidden legacy Sync
    // is not a permitted substitute for navigating Settings and its real tab.
    if (!workspaceMenuScreens.some(screen => screen.title === name)) throw new Error("Absent actual native menu item");
    await act(async () => view.rerender(h("main", { "aria-label": name }, name === "Settings" ? h(ServiceSettings, {
      values: settings, request: settingsRequest, onChanged: vi.fn(), onSave: vi.fn(async () => {}),
      syncSettings: h("p", null, "Integrated-only mode. Wavelog synchronization is disabled. Choose Integrated logbook + Wavelog synchronization in Settings → Logbook to enable it."),
    }) : null)));
  });
  const click = vi.fn(async (name: string, selector = "button") => {
    const element = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(item => item.textContent === name);
    if (!element || element.disabled) throw new Error("Unavailable actual Settings action");
    await act(async () => { fireEvent.click(element); });
  });
  return { worker, navigate, click, settingsRequest };
}

it("tests only visible native menu routes and separately opens the actual Settings Sync tab without mutation", async () => {
  const context = await fixture();
  const result = await verifyWorkspaceMenuRoutes(context);
  expect(workspaceScreens.find(screen => screen.id === "sync")?.hidden).toBe(true);
  expect(result.nativeRoutes).toEqual(workspaceMenuScreens.map(screen => screen.id));
  expect(result.nativeRoutes).not.toContain("sync");
  expect(context.navigate.mock.calls.map(([name]) => name)).toEqual([...workspaceMenuScreens.map(screen => screen.title), "Settings"]);
  expect(context.click).toHaveBeenCalledExactlyOnceWith("Sync", '[role="tab"]');
  expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Sync");
  expect(result).toMatchObject({ settingsSync: true, settingsUnchanged: true, draftUnchanged: true, stationIO: false });
  expect(context.worker.mock.calls.map(([method]) => method)).toEqual([
    "settings_load", "logbook_operator_draft", "settings_load", "logbook_operator_draft",
  ]);
  expect(context.settingsRequest.mock.calls.some(([method]) => /save|run|connect|refresh/.test(String(method)))).toBe(false);
});

it.each(["settings", "draft"] as const)("rejects %s changes rather than claiming read-only navigation acceptance", async changed => {
  await expect(verifyWorkspaceMenuRoutes(await fixture(changed))).rejects.toThrow("changed the settings or operator draft");
});

it("rejects a missing isolated fixture before navigating or selecting any tab", async () => {
  const worker = vi.fn(async () => ({ result: {} })), navigate = vi.fn(), click = vi.fn();
  await expect(verifyWorkspaceMenuRoutes({ worker, navigate, click })).rejects.toThrow("Missing isolated local");
  expect(navigate).not.toHaveBeenCalled(); expect(click).not.toHaveBeenCalled();
});
