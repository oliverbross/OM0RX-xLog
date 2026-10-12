import { cwOutputLimit, defaultCWProfile, expandCWMacro, validateCWProfile, type CWContext, type CWMacro, type CWProfile } from "./cwMacros";
type Data = Record<string, any>;
export type CWRequest = (method: string, params?: Data) => Promise<Data>;
export type CWTarget = { output: "radio" | "winkeyer"; provider: string; generation: number; limit: number };
export type CWState = { armed: boolean; pending: boolean; owner: CWTarget | null; message: string; error: string; winkeyer: Data | null };
const errorText = (e: unknown) => e instanceof Error ? e.message : "CW outcome is uncertain. Use Stop; do not retry the message.";
const same = (a: CWTarget | null, b: CWTarget | null) => !!a && !!b && a.output === b.output && a.provider === b.provider && a.generation === b.generation;
const generation = (value: unknown): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error("Connection identity is unavailable. Reconnect explicitly before using macros.");
  return Number(value);
};

/** One main-window controller. Injectable I/O/clock keeps all tests off hardware. */
export class CWController {
  private state: CWState = { armed: false, pending: false, owner: null, message: "CW disarmed", error: "", winkeyer: null };
  private listeners = new Set<() => void>();
  private profile: CWProfile = defaultCWProfile;
  private provider = "direct_agent";
  private epoch = 0;
  private armedUntil = 0;
  private target: CWTarget | null = null;
  private intent = 0;
  private outputRevision = 0;
  private pollRevision = 0;
  private sending: Promise<unknown> | null = null;
  private arming: Promise<unknown> | null = null;
  private stopping: Promise<void> | null = null;
  private configurationValid = true;
  constructor(private request: CWRequest, private clock = () => performance.now(), private foreground = () => document.hasFocus() && document.visibilityState === "visible") {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(change: Partial<CWState>) { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener()); }
  configure(profile: unknown, provider: string) {
    void this.stop();
    try { this.profile = validateCWProfile(profile ?? defaultCWProfile); this.provider = provider; this.configurationValid = true; }
    catch (error) { this.configurationValid = false; this.epoch++; this.publish({ error: errorText(error) }); }
  }
  private current(epoch: number) {
    if (epoch !== this.epoch || !this.foreground()) throw new Error("CW context or focus changed; nothing further was queued.");
  }
  async pollWinKeyer() {
    const owner = this.state.owner, outputRevision = this.outputRevision, epoch = this.epoch;
    const pollRevision = ++this.pollRevision;
    try {
      const value = await this.request("winkeyer_snapshot");
      if (pollRevision !== this.pollRevision || epoch !== this.epoch) return;
      this.publish({ winkeyer: value });
      if (Number.isSafeInteger(value.last_intent)) this.intent = Math.max(this.intent, value.last_intent);
      if (this.target?.output === "winkeyer" && (value.generation !== this.target.generation || value.phase !== "ready" || value.armed_remaining_ms <= 0)) {
        this.armedUntil = 0; this.publish({ armed: false });
      }
      if (owner && owner === this.state.owner && outputRevision === this.outputRevision && !this.state.pending && !this.sending && owner.output === "winkeyer" && value.generation === owner.generation && value.phase === "ready" && !value.owns_output && !value.pending_characters) {
        this.publish({ owner: null });
      }
    } catch (error) {
      if (pollRevision === this.pollRevision && epoch === this.epoch && this.target?.output === "winkeyer") { this.armedUntil = 0; this.publish({ armed: false, error: errorText(error) }); }
    }
  }
  private async inspect(capabilities = true): Promise<CWTarget> {
    if (this.profile.output === "winkeyer") {
      const state = await this.request("winkeyer_snapshot"); this.publish({ winkeyer: state });
      if (state.phase !== "ready" || !state.status || !Number.isFinite(state.status_age_ms) || state.status_age_ms < 0 || state.status_age_ms > 2_000) throw new Error("Connect WinKeyer and wait for fresh status first.");
      if (Number.isSafeInteger(state.last_intent)) this.intent = Math.max(this.intent, state.last_intent);
      return { output: "winkeyer", provider: "winkeyer", generation: generation(state.generation), limit: cwOutputLimit("winkeyer", this.provider) };
    }
    if (this.provider === "hamlib") {
      const state = await this.request("hamlib_snapshot", { device: "radio" });
      const age = Date.now() - state.observed_at_ms;
      if (!state.tx_enabled || !Number.isFinite(age) || age > 5_000 || age < -5_000) throw new Error("Connect a local radio with transmit controls enabled and fresh readback.");
      if (!["CW", "CWR"].includes(state.fields?.mode?.Mode)) throw new Error("Set the radio to CW before arming macros.");
      if (capabilities) {
        const caps = await this.request("hamlib_capabilities", { device: "radio" });
        if (caps.capabilities?.["Can send Morse"] !== "Y" || caps.capabilities?.["Can stop Morse"] !== "Y") throw new Error("This Hamlib radio must report both Send Morse and Stop Morse support.");
      }
      return { output: "radio", provider: this.provider, generation: generation(state.generation), limit: cwOutputLimit("radio", this.provider) };
    }
    const state = await this.request("station_snapshot", { provider: this.provider });
    const commands = state.capabilities?.supported_commands ?? state.station?.supported_commands ?? [];
    if (state.source !== this.provider || !state.radio?.connected || !state.radio?.observed || !state.allow_transmit || !commands.includes("send_cw") || !commands.includes("clear_cw"))
      throw new Error("Connect a CW-capable radio with transmit controls enabled first.");
    if (!["CW", "CWR"].includes(state.radio.mode)) throw new Error("Set the radio to CW before arming macros.");
    const age = Date.now() - Number(state.radio.observed_at ?? state.radio.received_at) * 1000;
    if (!Number.isFinite(age) || age > 5_000 || age < -5_000) throw new Error("Radio readback is stale; macros remain disarmed.");
    return { output: "radio", provider: this.provider, generation: generation(state.generation), limit: cwOutputLimit("radio", this.provider) };
  }
  async arm() {
    if (this.state.pending || this.state.owner || this.stopping) return;
    const epoch = ++this.epoch;
    let leaseTarget: CWTarget | null = null;
    this.publish({ pending: true, error: "", armed: false });
    try {
      this.current(epoch);
      if (!this.configurationValid) throw new Error("Save valid CW settings before arming.");
      const target = await this.inspect(); this.current(epoch);
      if (target.output === "winkeyer") {
        // Retain the exact connection before requesting its lease. A lost Arm
        // reply can still have armed the backend and must keep Stop available.
        leaseTarget = target; this.target = target;
        this.publish({ owner: target });
        this.arming = this.request("winkeyer_arm", { generation: target.generation, confirm_transmit: true });
        await this.arming;
        this.current(epoch);
      }
      this.target = target; this.armedUntil = this.clock() + 60_000;
      this.publish({ armed: true, owner: null, message: `${target.output === "winkeyer" ? "WinKeyer" : "Radio"} armed for 60 seconds` });
    } catch (error) {
      if (leaseTarget) await this.stop();
      const releaseError = this.state.owner ? this.state.error : "";
      this.publish({ error: [errorText(error), releaseError].filter(Boolean).join(" "), armed: false });
    } finally { this.arming = null; this.publish({ pending: false }); }
  }
  async send(macro: CWMacro, context: CWContext) {
    if (this.state.pending || this.stopping) return;
    const target = this.target, epoch = this.epoch;
    try {
      this.current(epoch);
      if (!target || !this.state.armed || this.armedUntil <= this.clock()) throw new Error("Arm CW before sending a macro.");
      const saved = this.profile.macros.find(item => item.id === macro.id && item.enabled);
      if (!saved) throw new Error("This macro is disabled or is not saved.");
      const text = expandCWMacro(saved.text, context, target.limit);
      this.publish({ pending: true, error: "" });
      const observed = await this.inspect(false); this.current(epoch);
      if (this.armedUntil <= this.clock()) throw new Error("CW arming expired during readback; arm again.");
      if (!same(target, observed)) throw new Error("Output connection changed. Arm the new connection explicitly.");
      if (this.state.owner && !same(this.state.owner, target)) throw new Error("Stop the previous CW output before choosing another.");
      this.outputRevision++;
      this.publish({ owner: target }); // before the request: lost acknowledgements retain Stop
      const sending = target.output === "winkeyer"
        ? this.request("winkeyer_send", { generation: target.generation, intent: ++this.intent, text })
        : target.provider === "hamlib" ? this.request("hamlib_control", { device: "radio", action: "cw", expected_generation: target.generation, text })
        : this.request("station_radio_control", { provider: target.provider, control: "send_cw", expected_generation: target.generation, text });
      this.sending = sending;
      await sending;
      if (epoch === this.epoch) this.publish({ message: `${saved.label} accepted · RF not verified` });
    } catch (error) {
      this.armedUntil = 0; this.publish({ armed: false, error: errorText(error) });
    } finally { this.sending = null; this.publish({ pending: false }); }
  }
  private async release(target: CWTarget) {
    if (target.output === "winkeyer") {
      await this.request("winkeyer_stop", { generation: target.generation });
      for (let attempt = 0; attempt < 30; attempt++) {
        const value = await this.request("winkeyer_snapshot");
        this.publish({ winkeyer: value });
        if (value.generation !== target.generation || value.phase !== "ready") break;
        if (!value.owns_output && !value.pending_characters && value.armed_remaining_ms === 0) return value;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error("WinKeyer Stop was requested but idle is unconfirmed. Check the keyer; ownership is retained.");
    }
    return target.provider === "hamlib" ? this.request("hamlib_control", { device: "radio", action: "cw_stop", expected_generation: target.generation })
      : this.request("station_radio_control", { provider: target.provider, control: "clear_cw", expected_generation: target.generation });
  }
  stop = (): Promise<void> => {
    ++this.epoch; this.armedUntil = 0;
    const target = this.state.owner ?? (this.target?.output === "winkeyer" ? this.target : null);
    this.target = null;
    this.publish({ armed: false, message: "CW disarmed" });
    if (this.stopping) return this.stopping;
    if (!target) return Promise.resolve();
    const sending = this.sending ?? this.arming;
    const operation = (async () => {
      try {
        // Release immediately. If Send was in flight, also release after it
        // settles: an early Stop must not overtake then leave a late Send active.
        let firstError: unknown;
        try { await this.release(target); } catch (error) { firstError = error; }
        if (sending) { await sending.catch(() => {}); await this.release(target); }
        else if (firstError) throw firstError;
        this.publish({ owner: null, message: "Stop requested · verify the output is idle", error: "" });
      } catch (error) { this.publish({ owner: target, error: errorText(error) }); }
    })();
    this.stopping = operation;
    void operation.finally(() => { this.stopping = null; this.publish({}); });
    return operation;
  };
  tick() { if (this.state.armed && this.clock() >= this.armedUntil) void this.stop(); }
  acknowledgeStopped() {
    if (this.sending || this.stopping || this.state.pending) return;
    this.epoch++; this.target = null; this.armedUntil = 0;
    this.publish({ owner: null, armed: false, error: "", message: "Operator confirmed CW stopped; re-arm explicitly." });
  }
}
