import { invoke } from "@tauri-apps/api/core";
import type { CWState } from "./cwController";
import { defaultCWProfile, validateCWProfile, type CWContext, type CWMacro, type CWProfile } from "./cwMacros";

type Data = Record<string, any>;
export type SharedCWState = CWState & { revision: number; lease: string | null; client: string | null; canonical: Data | null };
export type CWTransport = (client: string, sequence: number, params: Data) => Promise<Data>;
const native: CWTransport = (client, sequence, params) => invoke("cw_session_request", { client, sequence, params });
/** Renderer adapter only. Native owns the lease, saved text, context, expiry,
 * output guard and Stop ordering. An unknown IPC outcome is never retried. */
export class SharedCWSession {
  private state: SharedCWState = { revision: -1, lease: null, client: null, canonical: null, armed: false,
    pending: false, owner: null, message: "Loading shared CW session", error: "", winkeyer: null };
  private listeners = new Set<() => void>();
  private sequence = 0;
  private disposed = false;
  private uncertain = false;
  constructor(private transport = native, readonly client = crypto.randomUUID()) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private update(change: Partial<SharedCWState>) { this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener()); }
  private async action(action: string, params: Data = {}) {
    if (this.disposed && action !== "unregister") return;
    try {
      const value = await this.transport(this.client, ++this.sequence, { action, ...params });
      if (this.disposed) return;
      if (!Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.armed !== "boolean" || typeof value.pending !== "boolean" || typeof value.error !== "string") throw new Error("Shared CW response could not be verified. Use Stop before retrying.");
      if (value.revision < this.state.revision) return;
      if (value.canonical) validateCWProfile(value.canonical.profile);
      if (action === "arm" || action === "stop" || action === "acknowledge") this.uncertain = false;
      this.update({ ...value, armed: value.armed && value.client === this.client && !this.uncertain,
        error: this.uncertain ? "CW acknowledgement was lost. Use Stop; do not retry the macro." : value.error } as SharedCWState);
      return value;
    } catch (cause) {
      if (!this.disposed) {
        if (action === "send" || action === "contest" || action === "arm" || action === "stop") this.uncertain = true;
        this.update({ armed: false, error: cause instanceof Error ? cause.message : String(cause) });
        // An Arm rejection/lost reply must release only our lease: another
        // window may have won admission after our last observed snapshot.
        if (action === "arm") await this.action("unregister");
      }
    }
  }
  refresh = () => this.action("snapshot").then(() => {});
  pollWinKeyer = () => this.refresh();
  arm = () => this.action("arm", { expectedRevision: this.state.revision }).then(() => {});
  send = (macro: CWMacro, _previewContext?: CWContext) => this.action("send", { expectedRevision: this.state.revision, lease: this.state.lease, macroID: macro.id }).then(() => {});
  executeContest = (params: Data) => this.action("contest", { ...params, expectedRevision: this.state.revision, lease: this.state.lease });
  stop = () => this.action("stop").then(() => {});
  // Focus/renderer lifecycle releases only this client's lease. Explicit Stop
  // remains global so any visible CW control can clear retained output.
  release = () => this.action("unregister").then(() => {});
  activate = () => { this.disposed = false; };
  acknowledgeStopped = () => { void this.action("acknowledge", { expectedRevision: this.state.revision, confirmed: true }); };
  dispose = () => { this.disposed = true; void this.action("unregister"); };
}
export const sharedCWProfile = (state: SharedCWState): CWProfile => state.canonical?.profile ?? defaultCWProfile;
