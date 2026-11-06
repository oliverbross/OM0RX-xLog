// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { selectCustomCanvas } from "./workspaceCanvasAcceptance";
import OperatorCanvas from "./live/OperatorCanvas";
import { changedLayout, panelMinimum, workspacePanelIDs, WorkspaceLayoutSession, type LayoutSnapshot } from "./live/workspaceLayoutSession";
import * as transport from "./live/workspaceLayoutTransport";

function initial(): LayoutSnapshot {
  const panels = workspacePanelIDs.map((id, z) => {
    const [width, height] = panelMinimum(id);
    return { id, z, placement: "hidden" as const, rect: { x: 0, y: 0, width, height } };
  });
  return { generation: "12345678-1234-1234-1234-123456789abc", revision: 0,
    document: { version: 2, activePresetID: "traditional", presets: [
      { id: "traditional", name: "Traditional", width: 1920, height: 800, locked: true, snap: true, panels },
    ] } };
}
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0,
    right: 1280, bottom: 800, width: 1280, height: 800, toJSON() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

type Scenario = "none" | "pre" | "post" | "unknown" | "pre-twice";
async function setup(scenario: Scenario = "pre", recoveryControl: "present" | "missing" | "disabled" | "settling" = "present") {
  let snapshot = initial(), firstApply = true, release: ((ticket: number) => void) | undefined;
  const begin = vi.spyOn(transport, "beginWorkspacePresentation").mockImplementation(() => {
    if (scenario === "pre-twice" || scenario === "pre" && fills.length === 1)
      return new Promise<number>(resolve => { release = resolve; });
    return Promise.resolve(37);
  });
  const request = vi.fn(async (method: string, params?: any) => {
    if (method === "workspace_layout_load") return { layout: structuredClone(snapshot) };
    if (method !== "workspace_layout_apply") throw new Error(`Unexpected method ${method}`);
    if (scenario === "post" && firstApply) {
      firstApply = false; snapshot = { ...snapshot, revision: snapshot.revision + 1 };
      return { status: "conflict", layout: structuredClone(snapshot) };
    }
    expect(params.expectedRevision).toBe(snapshot.revision);
    snapshot = { ...snapshot, revision: snapshot.revision + 1, document: changedLayout(snapshot.document, params) };
    return { status: "applied", layout: structuredClone(snapshot) };
  });
  const session = new WorkspaceLayoutSession(request); await session.refresh();
  let finishChange = () => {};
  if (recoveryControl === "settling") {
    // Keep the real post-journal conflict rendered while the outer operation
    // has not completed. OperatorCanvas itself controls the disabled state.
    const applied = session.applyAtBase.bind(session);
    const completion = new Promise<void>(resolve => { finishChange = resolve; });
    vi.spyOn(session, "applyAtBase").mockImplementationOnce(async (...args) => {
      await applied(...args); await completion;
    });
  }
  function Harness() {
    const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <OperatorCanvas state={state} session={session} canChangeLayout={() => scenario !== "unknown"}
      traditional={<input aria-label="Retained draft" defaultValue="W1AW" />}
      panels={{ "active-qso": { title: "Active QSO", content: <input aria-label="Retained draft" defaultValue="W1AW" /> } }} />;
  }
  render(<Harness />);
  const fills: string[] = [], clicks: string[] = [];
  const controls = {
    fill: async (selector: string, value: string) => {
      fills.push(value);
      await act(async () => {
        fireEvent.change(document.querySelector(selector)!, { target: { value } });
        if (release) {
          snapshot = { ...snapshot, revision: snapshot.revision + 1 };
          await session.refresh();
          const resume = release; release = undefined; resume(37);
        }
      });
      if (fills.length === 1 && scenario === "pre") {
        expect(screen.getByRole("alert").textContent).toContain("The workspace changed after editing began.");
        expect(session.getSnapshot().pending).toBeNull();
        expect(request.mock.calls.filter(([method]) => method === "workspace_layout_apply")).toHaveLength(0);
        expect((screen.getByLabelText("Retained draft") as HTMLInputElement).value).toBe("W1AW");
      }
      if (fills.length === 1 && (recoveryControl === "missing" || recoveryControl === "disabled")) {
        const name = scenario === "post" ? "Use saved layout" : "Reload layout";
        const button = screen.getByRole("button", { name }) as HTMLButtonElement;
        if (recoveryControl === "missing") button.remove(); else button.disabled = true;
      }
    },
    click: async (name: string, selector = "button") => {
      const button = [...document.querySelectorAll<HTMLButtonElement>(selector)].find(item => item.textContent?.trim() === name);
      if (!button || button.disabled) throw new Error(`Unavailable recovery control: ${name}`);
      clicks.push(name);
      await act(async () => { fireEvent.click(button); });
    },
  };
  return { controls, fills, clicks, session, request, begin, finishChange, current: () => snapshot };
}

function startSelection(controls: Parameters<typeof selectCustomCanvas>[0]) {
  let firstFill: () => void = () => {};
  const filled = new Promise<void>(resolve => { firstFill = resolve; });
  let completed = false;
  const attempt = selectCustomCanvas({
    ...controls,
    fill: async (...args) => { await controls.fill(...args); firstFill(); },
  }).then(value => { completed = true; return { value }; }, error => { completed = true; return { error }; });
  return { filled, attempt, completed: () => completed };
}

it("recovers the actual pre-journal stale-render rejection through Reload layout before one fresh selection", async () => {
  const context = await setup("pre");
  await expect(selectCustomCanvas(context.controls)).resolves.toEqual({ layoutConflictRecovered: true });
  expect(context.clicks).toEqual(["Reload layout"]);
  expect(context.fills).toEqual(["custom", "custom"]);
  expect(context.current().document.activePresetID).toBe("custom");
  expect(context.session.getSnapshot().pending).toBeNull();
}, 25_000);

it("preserves post-journal conflict review through Use saved layout before one fresh selection", async () => {
  const context = await setup("post");
  await expect(selectCustomCanvas(context.controls)).resolves.toEqual({ layoutConflictRecovered: true });
  expect(context.clicks).toEqual(["Use saved layout"]);
  expect(context.fills).toEqual(["custom", "custom"]);
  expect(context.current().document.activePresetID).toBe("custom");
  expect(context.session.getSnapshot().pending).toBeNull();
  expect(context.request.mock.calls.filter(([method]) => method === "workspace_layout_apply")
    .map(([, params]) => params.action)).toEqual(["savePreset", "savePreset", "activatePreset"]);
});

it("waits for the actual post-journal recovery control while the outer operation is still settling", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const context = await setup("post", "settling");
  const selection = startSelection(context.controls);
  try {
    await selection.filled;
    await vi.advanceTimersByTimeAsync(100);
    expect((screen.getByRole("button", { name: "Use saved layout" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Saving layout…");
    expect(context.session.getSnapshot().saving).toBe(false);
    expect(context.session.getSnapshot().pending).not.toBeNull();
    expect(context.fills).toEqual(["custom"]); expect(context.clicks).toEqual([]);
    expect((screen.getByLabelText("Retained draft") as HTMLInputElement).value).toBe("W1AW");
    expect(selection.completed() ? await selection.attempt : { pending: true }).toEqual({ pending: true });

    await act(async () => { context.finishChange(); });
    await vi.advanceTimersByTimeAsync(50);
    expect(await selection.attempt).toEqual({ value: { layoutConflictRecovered: true } });
    expect(context.clicks).toEqual(["Use saved layout"]);
    expect(context.fills).toEqual(["custom", "custom"]);
    expect(context.current().document.activePresetID).toBe("custom");
    expect(context.session.getSnapshot().pending).toBeNull();
    expect((screen.getByLabelText("Retained draft") as HTMLInputElement).value).toBe("W1AW");
    expect(context.request.mock.calls.filter(([method]) => method === "workspace_layout_apply")
      .map(([, params]) => params.action)).toEqual(["savePreset", "savePreset", "activatePreset"]);
  } finally {
    await act(async () => { context.finishChange(); });
  }
});

it("acknowledges an ordinary selection without any recovery or second selection", async () => {
  const context = await setup("none");
  await expect(selectCustomCanvas(context.controls)).resolves.toEqual({ layoutConflictRecovered: false });
  expect(context.fills).toEqual(["custom"]); expect(context.clicks).toEqual([]);
  expect(context.current().document.activePresetID).toBe("custom");
});

it("rejects an unrelated real admission guard without clicking recovery or selecting again", async () => {
  const context = await setup("unknown");
  await expect(selectCustomCanvas(context.controls)).rejects.toThrow("Unexpected canvas recovery state");
  expect(context.fills).toEqual(["custom"]); expect(context.clicks).toEqual([]);
  expect(context.request.mock.calls.filter(([method]) => method === "workspace_layout_apply")).toHaveLength(0);
  expect((screen.getByLabelText("Retained draft") as HTMLInputElement).value).toBe("W1AW");
});

it.each(["pre", "post"] as const)("rejects missing %s recovery controls without another mutation", async scenario => {
  const context = await setup(scenario, "missing");
  await expect(selectCustomCanvas(context.controls)).rejects.toThrow("Unavailable canvas recovery control");
  expect(context.fills).toEqual(["custom"]); expect(context.clicks).toEqual([]);
});

it.each(["pre", "post"] as const)("rejects disabled %s recovery controls at the unchanged deadline without another mutation", async scenario => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const context = await setup(scenario, "disabled");
  const selection = startSelection(context.controls);
  await selection.filled;
  await vi.advanceTimersByTimeAsync(19_950);
  expect(selection.completed()).toBe(false);
  expect(context.fills).toEqual(["custom"]); expect(context.clicks).toEqual([]);
  await vi.advanceTimersByTimeAsync(50);
  const result = await selection.attempt;
  expect(result).toHaveProperty("error");
  if (!("error" in result)) throw new Error("Expected bounded recovery failure.");
  expect(result.error.message).toContain("Unavailable canvas recovery control");
  expect(result.error.message).toContain("Timed out: enabled canvas recovery control");
  expect(result.error.message).toContain('"disabled":true');
  expect(result.error.message).toContain('"layout":{"value":"traditional"');
  expect(context.fills).toEqual(["custom"]); expect(context.clicks).toEqual([]);
});

it.each(["unknown", "changed", "missing"] as const)("fails closed if the %s recovery changes while its action is settling", async change => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const context = await setup("post", "settling");
  const selection = startSelection(context.controls);
  try {
    await selection.filled;
    await vi.advanceTimersByTimeAsync(50);
    expect(selection.completed()).toBe(false);
    if (change === "missing") screen.getByRole("button", { name: "Use saved layout" }).remove();
    else screen.getByRole("alert").querySelector("span")!.textContent = change === "unknown" ? "Unreviewed layout error."
      : "The workspace changed after editing began. Reload and review it before saving.";
    await vi.advanceTimersByTimeAsync(50);
    const result = await selection.attempt;
    expect(result).toHaveProperty("error");
    if (!("error" in result)) throw new Error("Expected changed recovery failure.");
    expect(result.error.message).toContain(change === "missing" ? "Recovery control is missing."
      : change === "unknown" ? "Unexpected canvas recovery state" : "Canvas recovery state changed");
    expect(result.error.message).toContain('"status":"Saving layout…"');
    expect(context.fills).toEqual(["custom"]); expect(context.clicks).toEqual([]);
    expect((screen.getByLabelText("Retained draft") as HTMLInputElement).value).toBe("W1AW");
    expect(context.request.mock.calls.filter(([method]) => method === "workspace_layout_apply")).toHaveLength(1);
  } finally {
    await act(async () => { context.finishChange(); });
  }
});

it("stops after a second real stale-render rejection instead of retrying the selection again", async () => {
  const context = await setup("pre-twice");
  await expect(selectCustomCanvas(context.controls)).rejects.toThrow("Custom canvas was not acknowledged after reviewed recovery");
  expect(context.fills).toEqual(["custom", "custom"]);
  expect(context.clicks).toEqual(["Reload layout"]);
  expect(context.request.mock.calls.filter(([method]) => method === "workspace_layout_apply")).toHaveLength(0);
  expect(context.current().document.activePresetID).toBe("traditional");
  expect(context.session.getSnapshot().pending).toBeNull();
});
