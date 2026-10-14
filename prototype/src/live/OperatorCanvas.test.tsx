// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import OperatorCanvas from "./OperatorCanvas";
import { adjustPanel, customDeskPreset, fitPanelHeight } from "./canvasGeometry";
import { changedLayout, panelMinimum, validLayoutDocument, workspacePanelIDs, WorkspaceLayoutSession, type LayoutSnapshot } from "./workspaceLayoutSession";
function base(): LayoutSnapshot {
  const panels = workspacePanelIDs.map((id, z) => { const [width, height] = panelMinimum(id); return { id, z, placement: "hidden" as const, rect: { x: 0, y: 0, width, height } }; });
  const traditional = { id: "traditional", name: "Traditional", width: 1920, height: 800, locked: true, snap: true, panels };
  return { generation: "12345678-1234-1234-1234-123456789abc", revision: 0,
    document: { version: 2, activePresetID: "traditional", presets: [traditional] } };
}
let width = 1280;
beforeEach(() => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ x: 0, y: 0, left: 0, top: 0, bottom: 800, right: width, width, height: 800, toJSON() {} }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); width = 1280; });
function setup(custom = false, required = false, admission: { canChangeLayout?: () => boolean; onChangeInFlight?: (active: boolean) => void } = {}) {
  let snapshot = base(); if (custom) { snapshot.document.presets.push(customDeskPreset(snapshot.document.presets[0], 800)); snapshot.document.activePresetID = "custom"; }
  const request = vi.fn(async (method: string, params?: any) => {
    if (method === "workspace_layout_apply") snapshot = { ...snapshot, revision: snapshot.revision + 1, document: changedLayout(snapshot.document, params) };
    return { status: "applied", layout: structuredClone(snapshot) };
  });
  const session = new WorkspaceLayoutSession(request);
  function Harness() { const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
    return <OperatorCanvas {...admission} state={state} session={session} traditional={<p>Traditional controls</p>} panels={{
      "active-qso": { title: "Active QSO", content: <input aria-label="Draft text" defaultValue="W1AW" /> },
      "world-map": { title: "Map", content: <p>Map surface</p> },
      "band-maps": { title: "Bands", content: <p>Band surface</p> },
      "callsign-intelligence": { title: "Callsign intelligence", content: <section className="desk-panel desk-intelligence">Callsign details</section> },
      rotor: { title: "Rotor", required, content: <section className="desk-panel desk-rotor"><button>Stop rotor</button></section>, safetyAction: <button>Always available Stop</button> },
    }} />;
  }
  return { session, request, Harness };
}
it("retains the mounted editor when buffered input vetoes Hide or preset changes", async () => {
  const { session, request, Harness } = setup(true, false, { canChangeLayout: () => false });
  await session.refresh(); render(<Harness />);
  const input = screen.getByLabelText("Draft text"); fireEvent.change(input, { target: { value: "14.." } });
  fireEvent.click(screen.getByRole("button", { name: "Hide Active QSO" }));
  expect(screen.getByRole("alert").textContent).toContain("Your text is retained");
  fireEvent.change(screen.getByLabelText("Desk layout"), { target: { value: "traditional" } });
  expect(request.mock.calls.filter(([method]) => method === "workspace_layout_apply")).toHaveLength(0);
  expect(screen.getByLabelText("Draft text")).toBe(input); expect((input as HTMLInputElement).value).toBe("14..");
});
it("announces layout admission synchronously and holds it until the awaited update settles", async () => {
  const changed = vi.fn(), { session, request, Harness } = setup(true, false, { canChangeLayout: () => true, onChangeInFlight: changed });
  await session.refresh(); render(<Harness />);
  const backend = request.getMockImplementation()!; let release!: () => void;
  request.mockImplementation(async (method, params) => {
    expect(changed).toHaveBeenLastCalledWith(true);
    await new Promise<void>(resolve => { release = resolve; }); return backend(method, params);
  });
  fireEvent.click(screen.getByRole("button", { name: "Hide Active QSO" }));
  expect(changed).toHaveBeenCalledExactlyOnceWith(true); expect(screen.getByLabelText("Draft text")).toBeTruthy();
  await act(async () => release());
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(false)); expect(screen.queryByLabelText("Draft text")).toBeNull();
});
it("creates a custom canvas without altering Traditional and commits activation only after save", async () => {
  const { session, request, Harness } = setup(); await session.refresh(); render(<Harness />);
  fireEvent.change(screen.getByLabelText("Desk layout"), { target: { value: "custom" } });
  await screen.findByRole("button", { name: "Lock layout" });
  expect(request.mock.calls.filter(([method]) => method.endsWith("apply")).map(([, params]) => params.action)).toEqual(["savePreset", "activatePreset"]);
  expect(session.getSnapshot().snapshot?.document.presets[0]).toEqual(base().document.presets[0]);
  fireEvent.change(screen.getByLabelText("Desk layout"), { target: { value: "traditional" } });
  await screen.findByText("Traditional controls");
});
it("commits one keyboard move on key release, supports cancel, and keeps panel input mounted", async () => {
  const { session, request, Harness } = setup(true); await session.refresh(); render(<Harness />);
  const input = screen.getByLabelText("Draft text"); fireEvent.change(input, { target: { value: "K1ABC" } });
  const move = screen.getByRole("button", { name: "Move Active QSO" });
  fireEvent.keyDown(move, { key: "ArrowRight" }); fireEvent.keyDown(move, { key: "ArrowRight" });
  expect(request).toHaveBeenCalledTimes(1); fireEvent.keyUp(move, { key: "ArrowRight" });
  await waitFor(() => expect(session.getSnapshot().snapshot?.revision).toBe(1));
  expect(session.getSnapshot().snapshot?.document.presets[1].panels[0].rect.x).toBe(16);
  expect(screen.getByLabelText("Draft text")).toBe(input); expect((input as HTMLInputElement).value).toBe("K1ABC");
  fireEvent.keyDown(move, { key: "ArrowDown" }); fireEvent.keyDown(move, { key: "Escape" }); fireEvent.keyUp(move, { key: "ArrowDown" });
  expect(request).toHaveBeenCalledTimes(2);
});
it("hides and restores a panel, then removes edit handles when locked", async () => {
  const { session, Harness } = setup(true); await session.refresh(); render(<Harness />);
  const move = screen.getByRole("button", { name: "Move Map" });
  fireEvent.keyDown(move, { key: "ArrowRight" }); fireEvent.keyUp(move, { key: "ArrowRight" });
  await waitFor(() => expect(session.getSnapshot().snapshot?.revision).toBe(1));
  const savedRect = session.getSnapshot().snapshot!.document.presets[1].panels.find(panel => panel.id === "world-map")!.rect;
  await waitFor(() => expect((screen.getByRole("button", { name: "Hide Map" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Hide Map" }));
  await waitFor(() => expect(screen.queryByText("Map surface")).toBeNull());
  await waitFor(() => expect((screen.getByRole("button", { name: "Panels" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Panels" })); fireEvent.click(screen.getByRole("checkbox", { name: "Map" }));
  await screen.findByText("Map surface");
  expect(session.getSnapshot().snapshot!.document.presets[1].panels.find(panel => panel.id === "world-map")!.rect).toEqual(savedRect);
  // The restored panel renders before perform() releases its busy guard.
  await waitFor(() => expect((screen.getByRole("button", { name: "Lock layout" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Lock layout" }));
  await screen.findByRole("button", { name: "Arrange panels" }); expect(screen.queryByRole("button", { name: "Move Active QSO" })).toBeNull();
});
it("keeps Stop outside overlapping frames in a locked desktop layout", async () => {
  const { session, Harness } = setup(true, true); await session.refresh();
  const preset = session.getSnapshot().snapshot!.document.presets[1];
  await session.apply({ action: "savePreset", presetID: preset.id, preset: { ...preset, locked: true, panels: preset.panels.map(panel => panel.id === "rotor" ? { ...panel, placement: "canvas", z: 0, rect: { x: 0, y: 0, width: 320, height: 340 } } : panel.id === "active-qso" ? { ...panel, z: 9999 } : panel) } });
  render(<Harness />);
  const stop = screen.getByRole("button", { name: "Always available Stop" });
  expect(stop.closest(".canvas-toolbar")).toBeTruthy();
  expect(stop.closest(".canvas-frame")).toBeNull();
  expect((stop as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole("button", { name: "Arrange panels" })).toBeTruthy();
});
it("commits pointer placement once on release and cancels a interrupted gesture", async () => {
  const { session, request, Harness } = setup(true); await session.refresh(); render(<Harness />);
  const move = screen.getByRole("button", { name: "Move Active QSO" });
  fireEvent.pointerDown(move, { button: 0, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(move, { clientX: 120, clientY: 60 });
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.pointerUp(move); fireEvent.lostPointerCapture(move);
  await waitFor(() => expect(session.getSnapshot().snapshot?.revision).toBe(1));
  expect(session.getSnapshot().snapshot?.document.presets[1].panels[0].rect).toMatchObject({ x: 152, y: 40 });
  fireEvent.pointerDown(move, { button: 0, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(move, { clientX: 80, clientY: 80 }); fireEvent.pointerCancel(move); fireEvent.pointerUp(move);
  expect(request).toHaveBeenCalledTimes(2);
});
it("compact selection never hides an owned rotor Stop and forbids hiding that device", async () => {
  width = 640; const { session, Harness } = setup(true, true); await session.refresh(); render(<Harness />);
  expect(screen.getByRole("button", { name: "Stop rotor" })).toBeTruthy();
  expect(screen.getByLabelText("Visible desk panel")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Panels" }));
  expect((screen.getByRole("checkbox", { name: "Rotor · active device" }) as HTMLInputElement).disabled).toBe(true);
});
it("retains traditional operating controls when the layout service fails", async () => {
  const { session, request, Harness } = setup(); request.mockRejectedValueOnce(new Error("Layout unavailable")); await session.refresh(); render(<Harness />);
  expect(screen.getByText("Traditional controls")).toBeTruthy(); expect(screen.getByRole("alert").textContent).toContain("Layout unavailable");
  expect((screen.getByLabelText("Desk layout") as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Reload layout" }));
  await waitFor(() => expect((screen.getByLabelText("Desk layout") as HTMLSelectElement).disabled).toBe(false));
});
it("clamps movement/resize, validates seeded layouts and does not mutate source geometry", () => {
  const initial = base().document.presets[0];
  for (const equipment of [undefined, "rotor", "antenna"] as const) {
    const preset = customDeskPreset(initial, 640, equipment), panel = preset.panels[0];
    expect(validLayoutDocument({ version: 2, activePresetID: "custom", presets: [preset] })).toBe(true);
    const moved = adjustPanel(panel, preset, "move", 100000, 100000);
    expect(moved.rect.x + moved.rect.width).toBe(preset.width); expect(moved.rect.y + moved.rect.height).toBe(preset.height);
    const resized = adjustPanel(panel, preset, "resize", -100000, -100000);
    expect(resized.rect.width).toBe(520); expect(resized.rect.height).toBe(240); expect(panel.rect.x).toBe(0);
  }
});

it("exposes named resize grips with keyboard instructions and commits only the final keyboard size", async () => {
  const { session, request, Harness } = setup(true); await session.refresh(); render(<Harness />);
  const resize = screen.getByRole("button", { name: "Resize Active QSO" });
  expect(resize.textContent).toContain("Resize");
  expect(resize.closest(".canvas-frame-resize-tools")).toBeTruthy();
  expect(document.getElementById(resize.getAttribute("aria-describedby")!)?.textContent).toContain("Escape cancels");
  const before = session.getSnapshot().snapshot!.document.presets[1], panel = before.panels[0];
  fireEvent.keyDown(resize, { key: "ArrowDown", shiftKey: true });
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(resize, { key: "Escape" }); fireEvent.keyUp(resize, { key: "ArrowDown" });
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(resize, { key: "ArrowLeft", shiftKey: true }); fireEvent.keyUp(resize, { key: "ArrowLeft" });
  await waitFor(() => expect(session.getSnapshot().snapshot?.revision).toBe(1));
  expect(session.getSnapshot().snapshot!.document.presets[1].panels[0].rect).toEqual(adjustPanel(panel, before, "resize", -32, 0).rect);
});

it("commits a pointer resize once and retains cancellation on the visible corner grip", async () => {
  const { session, request, Harness } = setup(true); await session.refresh(); render(<Harness />);
  const before = session.getSnapshot().snapshot!.document.presets[1], panel = before.panels[0];
  const resize = screen.getByRole("button", { name: "Resize Active QSO" });
  fireEvent.pointerDown(resize, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(resize, { clientX: 20, clientY: 60 });
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.pointerUp(resize); fireEvent.lostPointerCapture(resize);
  await waitFor(() => expect(session.getSnapshot().snapshot?.revision).toBe(1));
  expect(session.getSnapshot().snapshot!.document.presets[1].panels[0].rect).toEqual(adjustPanel(panel, before, "resize", -120, -40).rect);
  fireEvent.pointerDown(resize, { button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(resize, { clientX: 60, clientY: 40 }); fireEvent.pointerCancel(resize); fireEvent.pointerUp(resize);
  expect(request).toHaveBeenCalledTimes(2);
});

it("fits measured information content only on request, retaining position, width, neighbours and mounted content", async () => {
  const { session, request, Harness } = setup(true); await session.refresh();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = this.matches(".desk-panel") ? 120 : this.matches(".canvas-frame-tools, .canvas-frame-resize-tools") ? 36 : 800;
    return { x: 0, y: 0, left: 0, top: 0, bottom: height, right: width, width, height, toJSON() {} };
  });
  render(<Harness />);
  const details = screen.getByText("Callsign details"), before = structuredClone(session.getSnapshot().snapshot!.document.presets[1]);
  expect(details.closest(".is-content-sized")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Fit height of Map" })).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Fit height of Callsign intelligence" }));
  await waitFor(() => expect(session.getSnapshot().snapshot?.revision).toBe(1));
  const after = session.getSnapshot().snapshot!.document.presets[1];
  expect(after.panels.find(panel => panel.id === "callsign-intelligence")!.rect.height).toBe(240);
  expect(after.panels).toEqual(before.panels.map(panel => panel.id === "callsign-intelligence" ? { ...panel, rect: { ...panel.rect, height: 240 } } : panel));
  expect(screen.getByText("Callsign details")).toBe(details);
});

it("keeps fit and resize changes behind the buffered-input admission gate", async () => {
  const { session, request, Harness } = setup(true, false, { canChangeLayout: () => false });
  await session.refresh();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const height = this.matches(".desk-panel") ? 120 : this.matches(".canvas-frame-tools, .canvas-frame-resize-tools") ? 36 : 800;
    return { x: 0, y: 0, left: 0, top: 0, bottom: height, right: width, width, height, toJSON() {} };
  });
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "Fit height of Callsign intelligence" }));
  expect(screen.getByRole("alert").textContent).toContain("Your text is retained");
  const resize = screen.getByRole("button", { name: "Resize Active QSO" });
  fireEvent.keyDown(resize, { key: "ArrowLeft" }); fireEvent.keyUp(resize, { key: "ArrowLeft" });
  expect(screen.getByRole("alert").textContent).toContain("Your text is retained");
  expect(request).toHaveBeenCalledTimes(1);
});

it("trims height with upward snapping and minimums without growing or changing overlaps", () => {
  const preset = customDeskPreset(base().document.presets[0], 800), panel = preset.panels.find(item => item.id === "callsign-intelligence")!;
  expect(fitPanelHeight(panel, preset, 249).rect).toEqual({ ...panel.rect, height: 256 });
  expect(fitPanelHeight(panel, preset, 20).rect.height).toBe(240);
  expect(fitPanelHeight(panel, preset, 500).rect).toEqual(panel.rect);
  expect(fitPanelHeight(panel, preset, NaN)).toBe(panel);
  expect(fitPanelHeight(panel, preset, 0)).toBe(panel);
  expect(fitPanelHeight(panel, { ...preset, snap: false }, 249.2).rect.height).toBe(250);
  expect(panel.rect.height).toBe(340);
});
