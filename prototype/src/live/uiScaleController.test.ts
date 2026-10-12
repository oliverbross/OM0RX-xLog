import { describe, expect, it, vi } from "vitest";
import { createUiScaleController, parseUiScalePreference, type UiScaleAdapter, type UiScalePreference } from "./uiScaleController";
const adapter = (overrides: Partial<UiScaleAdapter> = {}): UiScaleAdapter => ({ applyZoom: vi.fn(async () => {}), read: () => null, write: vi.fn(), publish: vi.fn(async () => {}), now: () => 1000, writer: "main", ...overrides });
const settled = async (controller: ReturnType<typeof createUiScaleController>) => vi.waitFor(() => expect(controller.getSnapshot().pending).toBe(false));
describe("nonsecret display scale coordinator", () => {
  it("validates only bounded known scales and strips arbitrary payload", () => {
    const good = { version: 1, scale: 1.5, revision: 12, writer: "main", token: "must-not-survive" };
    expect(parseUiScalePreference(JSON.stringify(good))).toEqual({ version: 1, scale: 1.5, revision: 12, writer: "main" });
    for (const value of [null, "bad-json", " ".repeat(513), [], { ...good, scale: 5 }, { ...good, revision: Infinity }, { ...good, writer: "bad/url" }, { ...good, revision: Number.MAX_SAFE_INTEGER }]) expect(parseUiScalePreference(value)).toBeNull();
  });
  it("defaults to 100%, loads a valid preference, and does not write or broadcast on startup", async () => {
    const io = adapter({ read: () => JSON.stringify({ version: 1, scale: 1.75, revision: 8, writer: "saved" }) });
    const controller = createUiScaleController(io); expect(controller.getSnapshot().scale).toBe(1); controller.start(); await settled(controller);
    expect(controller.getSnapshot().scale).toBe(1.75); expect(io.write).not.toHaveBeenCalled(); expect(io.publish).not.toHaveBeenCalled();
  });
  it("serializes async changes and discards intermediate superseded choices", async () => {
    const finishes: (() => void)[] = [], io = adapter({ applyZoom: vi.fn(() => new Promise<void>(resolve => { finishes.push(resolve); })) });
    const controller = createUiScaleController(io); controller.start(); controller.setScale(1.25); controller.setScale(2);
    expect(io.applyZoom).toHaveBeenCalledTimes(1); finishes.shift()!(); await vi.waitFor(() => expect(io.applyZoom).toHaveBeenCalledTimes(2));
    expect(io.applyZoom).toHaveBeenLastCalledWith(2); finishes.shift()!(); await settled(controller);
    expect(controller.getSnapshot().scale).toBe(2); expect(io.write).toHaveBeenCalledTimes(1); expect(JSON.parse(vi.mocked(io.write).mock.calls[0][0]).scale).toBe(2);
  });
  it("ignores stale and invalid external events without echoing accepted events", async () => {
    const io = adapter(), controller = createUiScaleController(io); controller.start(); await settled(controller);
    controller.accept({ version: 1, scale: 1.5, revision: 20, writer: "other" }); await settled(controller);
    controller.accept({ version: 1, scale: 2, revision: 19, writer: "other" }); controller.accept({ version: 1, scale: 99, revision: 100, writer: "other" });
    expect(controller.getSnapshot().scale).toBe(1.5); expect(io.publish).not.toHaveBeenCalled(); expect(io.write).not.toHaveBeenCalled();
  });
  it("converges main and detached views without loops or worker/control requests", async () => {
    let second!: ReturnType<typeof createUiScaleController>;
    const firstIO = adapter({ publish: vi.fn(async value => { second.accept(value); }) }), secondIO = adapter({ writer: "detached" });
    const first = createUiScaleController(firstIO); second = createUiScaleController(secondIO); first.start(); second.start(); await settled(first); await settled(second);
    first.setScale(1.5); await settled(first); await settled(second);
    expect(second.getSnapshot().scale).toBe(1.5); expect(firstIO.publish).toHaveBeenCalledOnce(); expect(secondIO.publish).not.toHaveBeenCalled();
  });
  it("keeps the last successful scale on failure and allows explicit Reset to recover", async () => {
    const io = adapter({ applyZoom: vi.fn(async scale => { if (scale === 1.5) throw new Error("native failure must not be exposed"); }) });
    const controller = createUiScaleController(io); controller.start(); await settled(controller); controller.setScale(1.5); await settled(controller);
    expect(controller.getSnapshot()).toMatchObject({ scale: 1, requestedScale: 1.5 }); expect(controller.getSnapshot().error).toContain("Reset to 100%"); expect(io.write).not.toHaveBeenCalled();
    controller.setScale(1); await settled(controller); expect(controller.getSnapshot().error).toBe(""); expect(io.write).toHaveBeenCalledOnce();
  });
  it("does not persist a disposed or externally superseded completion", async () => {
    let resolve!: () => void; const io = adapter({ applyZoom: vi.fn(() => new Promise<void>(finish => { resolve = finish; })) });
    const controller = createUiScaleController(io); controller.setScale(1.25); controller.dispose(); resolve(); await Promise.resolve(); await Promise.resolve();
    expect(io.write).not.toHaveBeenCalled(); expect(io.publish).not.toHaveBeenCalled();
  });
  it("reports restricted persistence and notification failures without misreporting applied zoom", async () => {
    const io = adapter({ write: () => { throw new Error("storage blocked"); }, publish: async () => { throw new Error("emit failed"); } });
    const controller = createUiScaleController(io); controller.setScale(2); await settled(controller);
    expect(controller.getSnapshot().scale).toBe(2); expect(controller.getSnapshot().error).toContain("other windows could not be notified");
  });
  it("uses writer ordering for simultaneous revisions and rejects unsupported local choices", async () => {
    const controller = createUiScaleController(adapter()); controller.accept({ version: 1, scale: 1.25, revision: 10, writer: "z-window" }); await settled(controller);
    controller.accept({ version: 1, scale: 2, revision: 10, writer: "a-window" }); controller.setScale(0.1);
    expect(controller.getSnapshot().scale).toBe(1.25); expect(controller.getSnapshot().error).toContain("100% to 200%");
  });
  it("repairs the losing last storage write after simultaneous equal-clock choices without broadcast loops", async () => {
    let raw: string | null = null;
    const io = adapter({ read: () => raw, write: value => { raw = value; }, writer: "z-main" });
    const controller = createUiScaleController(io); controller.start(); await settled(controller); controller.setScale(2); await settled(controller);
    const losing: UiScalePreference = { version: 1, scale: 1.25, revision: 1000, writer: "a-other" };
    raw = JSON.stringify(losing); controller.accept(losing);
    expect(parseUiScalePreference(raw)?.scale).toBe(2); expect(parseUiScalePreference(raw)?.writer).toBe("z-main"); expect(io.publish).toHaveBeenCalledOnce();
    const restarted = createUiScaleController(adapter({ read: () => raw })); restarted.start(); await settled(restarted); expect(restarted.getSnapshot().scale).toBe(2);
  });
  it("does not persist an in-flight local choice superseded by a newer external intent", async () => {
    const finishes: (() => void)[] = [], io = adapter({ applyZoom: vi.fn(() => new Promise<void>(resolve => { finishes.push(resolve); })) });
    const controller = createUiScaleController(io); controller.setScale(1.25); controller.accept({ version: 1, scale: 1.75, revision: 1001, writer: "other" });
    finishes.shift()!(); await vi.waitFor(() => expect(io.applyZoom).toHaveBeenLastCalledWith(1.75)); finishes.shift()!(); await settled(controller);
    expect(controller.getSnapshot().scale).toBe(1.75); expect(io.publish).not.toHaveBeenCalled(); expect(io.write).not.toHaveBeenCalled();
  });
});
