import { describe, expect, it, vi } from "vitest";
import { CWController, type CWRequest } from "./cwController";
import { defaultCWProfile } from "./cwMacros";

const context = { MYCALL: "OM0RX", CALL: "K1ABC", RST: "599" };
function deferred<T = Record<string, any>>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(output: "radio" | "winkeyer" = "radio", provider = "direct_agent") {
  let now = 0, focused = true;
  const profile = structuredClone(defaultCWProfile); profile.output = output;
  const radio = { source: provider, generation: 7, allow_transmit: true,
    radio: { connected: true, observed: true, mode: "CW", observed_at: Date.now() / 1000 },
    capabilities: { supported_commands: ["send_cw", "clear_cw"] } };
  const keyer = { generation: 12, phase: "ready", status: {}, status_age_ms: 0,
    armed_remaining_ms: 0, owns_output: false, pending_characters: 0, last_intent: 0 };
  const local = { generation: 21, tx_enabled: true, observed_at_ms: Date.now(), fields: { mode: { Mode: "CW" } } };
  const caps = { capabilities: { "Can send Morse": "Y", "Can stop Morse": "Y" } };
  const request = vi.fn<CWRequest>(async (method, params) => {
    if (method === "station_snapshot") return structuredClone(radio);
    if (method === "hamlib_snapshot") return structuredClone(local);
    if (method === "hamlib_capabilities") return caps;
    if (method === "winkeyer_snapshot") return structuredClone(keyer);
    if (method === "winkeyer_arm") keyer.armed_remaining_ms = 60_000;
    if (method === "winkeyer_stop") { keyer.armed_remaining_ms = 0; keyer.owns_output = false; }
    if (method === "winkeyer_send") { keyer.last_intent = params!.intent; keyer.owns_output = true; }
    return { accepted: true };
  });
  const controller = new CWController(request, () => now, () => focused);
  controller.configure(profile, provider);
  const writes = () => request.mock.calls.filter(([method]) => !method.endsWith("snapshot") && !method.endsWith("capabilities"));
  return { controller, profile, radio, keyer, local, caps, request, writes,
    advance: (milliseconds: number) => { now += milliseconds; }, focus: (value: boolean) => { focused = value; } };
}

describe("CW foreground output controller (injected I/O only)", () => {
  it("never keys on configuration, polling, disarmed send or radio arm", async () => {
    const f = fixture();
    await f.controller.pollWinKeyer();
    await f.controller.send(f.profile.macros[0], context);
    expect(f.writes()).toEqual([]);
    await f.controller.arm();
    expect(f.controller.getSnapshot().armed).toBe(true);
    expect(f.writes()).toEqual([]);
    await f.controller.stop();
    expect(f.controller.getSnapshot().message).toBe("CW disarmed");
    expect(f.writes()).toEqual([]);
  });

  it("uses saved text and fences send and stop to the armed connection", async () => {
    const f = fixture(); await f.controller.arm();
    await f.controller.send({ ...f.profile.macros[0], text: "UNSAVED TEXT" }, context);
    expect(f.writes()).toEqual([["station_radio_control", {
      provider: "direct_agent", control: "send_cw", expected_generation: 7, text: "CQ CQ DE OM0RX OM0RX K",
    }]]);
    expect(f.controller.getSnapshot().owner?.generation).toBe(7);
    await f.controller.stop();
    expect(f.writes()[1]).toEqual(["station_radio_control", { provider: "direct_agent", control: "clear_cw", expected_generation: 7 }]);
    expect(f.controller.getSnapshot().owner).toBeNull();
  });

  it.each(["generation", "mode", "stale", "opt-in", "capability", "focus", "expiry"])("rejects changed %s before send", async reason => {
    const f = fixture(); await f.controller.arm();
    if (reason === "generation") f.radio.generation++;
    if (reason === "mode") f.radio.radio.mode = "SSB";
    if (reason === "stale") f.radio.radio.observed_at -= 10;
    if (reason === "opt-in") f.radio.allow_transmit = false;
    if (reason === "capability") f.radio.capabilities.supported_commands = ["send_cw"];
    if (reason === "focus") f.focus(false);
    if (reason === "expiry") f.advance(60_001);
    await f.controller.send(f.profile.macros[0], context);
    expect(f.writes()).toEqual([]);
    expect(f.controller.getSnapshot().armed).toBe(false);
    expect(f.controller.getSnapshot().error).not.toBe("");
  });

  it("rechecks expiry after a slow readback and never replays its macro", async () => {
    const f = fixture(); await f.controller.arm();
    const readback = deferred(); f.request.mockImplementationOnce(() => readback.promise);
    const send = f.controller.send(f.profile.macros[0], context);
    f.advance(60_001); readback.resolve(f.radio); await send;
    expect(f.writes()).toEqual([]);
    await f.controller.arm(); expect(f.writes()).toEqual([]);
  });

  it("retains uncertain ownership after a lost send reply and stops only that generation", async () => {
    const f = fixture(); const base = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (method, params) => {
      if (method === "station_radio_control" && params?.control === "send_cw") throw new Error("Reply lost");
      return base(method, params);
    });
    await f.controller.arm(); await f.controller.send(f.profile.macros[0], context);
    expect(f.controller.getSnapshot()).toMatchObject({ armed: false, owner: { generation: 7 }, error: "Reply lost" });
    f.radio.generation = 8;
    f.request.mockImplementation(async (method, params) => {
      if (method === "station_radio_control") throw new Error("Stale generation");
      return base(method, params);
    });
    await f.controller.stop();
    expect(f.writes().at(-1)?.[1]?.expected_generation).toBe(7);
    expect(f.controller.getSnapshot().owner?.generation).toBe(7);
    await f.controller.arm(); // uncertain output cannot be re-armed
    expect(f.controller.getSnapshot().armed).toBe(false);
    f.controller.acknowledgeStopped(); expect(f.controller.getSnapshot().owner).toBeNull();
  });

  it("Stop releases immediately and again after an in-flight Send, never retries text", async () => {
    const f = fixture(); const pending = deferred(); const base = f.request.getMockImplementation()!;
    f.request.mockImplementation((method, params) => method === "station_radio_control" && params?.control === "send_cw" ? pending.promise : base(method, params));
    await f.controller.arm(); const send = f.controller.send(f.profile.macros[0], context);
    await vi.waitFor(() => expect(f.writes()).toHaveLength(1));
    const stop = f.controller.stop();
    expect(f.writes().map(([, p]) => p?.control)).toEqual(["send_cw", "clear_cw"]);
    f.controller.acknowledgeStopped(); expect(f.controller.getSnapshot().owner).not.toBeNull();
    pending.resolve({ accepted: true }); await Promise.all([send, stop]);
    expect(f.writes().map(([, p]) => p?.control)).toEqual(["send_cw", "clear_cw", "clear_cw"]);
    expect(f.controller.getSnapshot()).toMatchObject({ armed: false, owner: null, pending: false });
  });

  it("profile/provider changes disarm and release the old provider without fallback", async () => {
    const f = fixture(); await f.controller.arm(); await f.controller.send(f.profile.macros[0], context);
    f.controller.configure(f.profile, "direct_flex_lan"); await f.controller.stop();
    expect(f.writes().at(-1)).toEqual(["station_radio_control", { provider: "direct_agent", control: "clear_cw", expected_generation: 7 }]);
    expect(f.controller.getSnapshot().armed).toBe(false);
  });

  it("requires both Hamlib Morse capabilities and respects its 80 character limit", async () => {
    const f = fixture("radio", "hamlib"); f.caps.capabilities["Can stop Morse"] = "N";
    await f.controller.arm(); expect(f.controller.getSnapshot().armed).toBe(false);
    f.caps.capabilities["Can stop Morse"] = "Y";
    f.profile.macros[0].text = "C".repeat(81); f.controller.configure(f.profile, "hamlib");
    await f.controller.arm(); await f.controller.send(f.profile.macros[0], context);
    expect(f.controller.getSnapshot().error).toMatch(/allows 80/); expect(f.writes()).toEqual([]);
    f.profile.macros[0].text = "C".repeat(80); f.controller.configure(f.profile, "hamlib");
    await f.controller.arm(); await f.controller.send(f.profile.macros[0], context); await f.controller.stop();
    expect(f.writes().map(([, p]) => [p?.action, p?.expected_generation])).toEqual([["cw", 21], ["cw_stop", 21]]);
  });

  it("WinKeyer uses the explicit arm lease and increasing intents from backend state", async () => {
    const f = fixture("winkeyer"); f.keyer.last_intent = 38;
    await f.controller.arm(); // no background poll is required to recover the intent floor
    expect(f.writes()[0]).toEqual(["winkeyer_arm", { generation: 12, confirm_transmit: true }]);
    await f.controller.send(f.profile.macros[0], context);
    expect(f.writes()[1]?.[1]).toMatchObject({ generation: 12, intent: 39 });
    f.keyer.owns_output = false; await f.controller.pollWinKeyer();
    expect(f.controller.getSnapshot().owner).toBeNull();
    await f.controller.send(f.profile.macros[0], context);
    expect(f.writes().at(-1)?.[1]?.intent).toBe(40);
    f.advance(60_001); f.controller.tick(); await f.controller.stop();
    expect(f.controller.getSnapshot()).toMatchObject({ armed: false, owner: null });
    expect(f.writes().at(-1)?.[0]).toBe("winkeyer_stop");
  });

  it("releases an Arm which finishes after Stop, leaving no hidden keyer lease", async () => {
    const f = fixture("winkeyer"); const pending = deferred(); const base = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (method, params) => {
      if (method === "winkeyer_arm") { await pending.promise; f.keyer.armed_remaining_ms = 60_000; return {}; }
      return base(method, params);
    });
    const arm = f.controller.arm(); await vi.waitFor(() => expect(f.writes()).toHaveLength(1));
    const stop = f.controller.stop(); pending.resolve({}); await Promise.all([arm, stop]);
    expect(f.keyer.armed_remaining_ms).toBe(0);
    expect(f.controller.getSnapshot()).toMatchObject({ armed: false, pending: false, owner: null });
    expect(f.writes().filter(([method]) => method === "winkeyer_stop").length).toBeGreaterThanOrEqual(2);
    expect(f.writes().some(([method]) => method === "winkeyer_send")).toBe(false);
  });

  it("lost keyer Arm and failed Stop retain the old target for recovery", async () => {
    const f = fixture("winkeyer"); const base = f.request.getMockImplementation()!;
    f.request.mockImplementation(async (method, params) => {
      if (method === "winkeyer_arm") throw new Error("Arm reply lost");
      if (method === "winkeyer_stop") throw new Error("Keyer unavailable");
      return base(method, params);
    });
    await f.controller.arm();
    expect(f.controller.getSnapshot()).toMatchObject({ armed: false, pending: false, owner: { generation: 12 } });
    expect(f.controller.getSnapshot().error).toMatch(/Keyer unavailable/);
    expect(f.writes().filter(([method]) => method === "winkeyer_send")).toEqual([]);
  });

  it("an older idle poll cannot erase ownership of a newer Send", async () => {
    const f = fixture("winkeyer"); await f.controller.arm();
    const stalePoll = deferred(); f.request.mockImplementationOnce(() => stalePoll.promise);
    const poll = f.controller.pollWinKeyer();
    await f.controller.send(f.profile.macros[0], context);
    stalePoll.resolve({ ...f.keyer, owns_output: false }); await poll;
    expect(f.controller.getSnapshot().owner?.generation).toBe(12);
  });

  it("out-of-order polls cannot clear a second macro on the same armed target", async () => {
    const f = fixture("winkeyer"); await f.controller.arm(); await f.controller.send(f.profile.macros[0], context);
    const stalePoll = deferred(); f.request.mockImplementationOnce(() => stalePoll.promise);
    const poll = f.controller.pollWinKeyer();
    f.keyer.owns_output = false; await f.controller.pollWinKeyer();
    await f.controller.send(f.profile.macros[0], context);
    stalePoll.resolve({ ...f.keyer, owns_output: false, armed_remaining_ms: 0 }); await poll;
    expect(f.controller.getSnapshot()).toMatchObject({ armed: true, owner: { generation: 12 } });
  });
});
