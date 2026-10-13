// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
const invalidation = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({ listen: invalidation.listen }));
import { bandMapView } from "./workspacePreferences";
import { bandMapPatch, checkedPreferenceReply, connectPreferenceInvalidation } from "./bandMapPreferenceTransport";
import { syntheticMapContext } from "./mapContextFixtures";
describe("band map field intents", () => {
  it("sends only changed fields and their rendered baselines, never unrelated preferences", () => {
    const base = syntheticMapContext().metadata, view = bandMapView(base.preferences, false);
    expect(bandMapPatch(base, false, view, { ...view, modes: ["cw"], layout: "row" })).toEqual({
      generation: base.generation, scope: "detached", expected: { layout: "grid", modes: ["cw", "data", "phone"] }, patch: { layout: "row", modes: ["cw"] },
    });
    expect(bandMapPatch(base, true, bandMapView(base.preferences, true), { ...bandMapView(base.preferences, true), bands: ["40m"] }).patch).toEqual({ bands: ["40m"] });
    expect(bandMapPatch(base, false, view, view).patch).toEqual({});
  });
  it("requires a verified generation-bound acknowledgement", () => {
    const base = syntheticMapContext().metadata;
    expect(checkedPreferenceReply({ ...base, status: "applied" }).preferences).toEqual(base.preferences);
    expect(() => checkedPreferenceReply({ preferences: base.preferences, status: "applied" })).toThrow(/verified/);
    expect(() => checkedPreferenceReply({ ...base, status: "okay" })).toThrow(/verified/);
  });
  it("does not manufacture changes from another pending control in the same rendered frame", () => {
    const base = syntheticMapContext().metadata, rendered = bandMapView(base.preferences, false);
    const latest = { ...rendered, fontScale: 1.1 };
    expect(bandMapPatch(base, false, rendered, { ...rendered, bands: ["40m"] }, latest)).toMatchObject({
      expected: { bands: rendered.bands }, patch: { bands: ["40m"] },
    });
    expect(bandMapPatch(base, false, rendered, { ...rendered, bands: ["40m"] }, latest).patch).not.toHaveProperty("fontScale");
    expect(bandMapPatch(base, false, rendered, { ...rendered, fontScale: 1.2 }, latest).expected).toEqual({ fontScale: 1.1 });
  });
  it("handles listener rejection while retaining and disposing its focus fallback", async () => {
    invalidation.listen.mockRejectedValueOnce(new Error("fixture listener unavailable"));
    const wake = vi.fn(), dispose = connectPreferenceInvalidation(wake)!;
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    window.dispatchEvent(new Event("focus")); expect(wake).toHaveBeenCalledOnce();
    dispose(); window.dispatchEvent(new Event("focus")); expect(wake).toHaveBeenCalledOnce();
  });
  it("disposes a listener registered after teardown and ignores late wake callbacks", async () => {
    let registered!: (stop: () => void) => void;
    invalidation.listen.mockImplementationOnce(() => new Promise(resolve => { registered = resolve; }));
    const wake = vi.fn(), stop = vi.fn(), dispose = connectPreferenceInvalidation(wake)!;
    const callback = invalidation.listen.mock.calls.at(-1)![1];
    dispose(); registered(stop); await Promise.resolve(); await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce(); callback(); window.dispatchEvent(new Event("focus"));
    expect(wake).not.toHaveBeenCalled();
  });
});
