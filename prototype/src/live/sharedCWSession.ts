import { invoke } from "@tauri-apps/api/core";
import type { CWState } from "./cwController";
import { defaultCWProfile, validateCWProfile, type CWContext, type CWMacro, type CWProfile } from "./cwMacros";

type Data = Record<string, any>;
export type SharedCWState = CWState & { revision: number; lease: string | null; client: string | null; canonical: Data | null;
  messageContext?: CWContext | null; messageContextError?: string | null;
  composition?: {jobID: string; appendSequence: number; accepted: string; closed: boolean; evidence: string; reportedCharacters?: number | null} | null;
  capabilities?: { speedSegments?: boolean; streaming?: boolean; composition?: boolean; prosigns?: boolean; progressEvidence?: string; compositionReason?: string | null } };
export type CWComposeRequest = {jobID: string; appendSequence: number; template: string; live: boolean; finish: boolean; inputOrigin: "typing" | "explicit-send"};
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
  private update(change: Partial<SharedCWState>) {
    // Repeated failed passive reads can report the same disarmed/error fields.
    // Keep every authority read and uncertainty transition; notify on new state.
    if ((Object.keys(change) as Array<keyof SharedCWState>).every(key => Object.is(this.state[key], change[key]))) return;
    this.state = { ...this.state, ...change }; this.listeners.forEach(listener => listener());
  }
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
        if (action === "send" || action === "compose" || action === "contest" || action === "arm" || action === "stop") this.uncertain = true;
        this.update({ armed: false, error: cause instanceof Error ? cause.message : String(cause) });
        // An Arm rejection/lost reply must release only our lease: another
        // window may have won admission after our last observed snapshot.
        if (action === "arm") await this.action("unregister");
      }
    }
  }
  refresh = () => this.action("snapshot").then(() => {});
  pollWinKeyer = () => this.refresh();
  arm = (contestSurfaceRequestID?: string, controlSurface?: "setup") => this.action("arm", {
    expectedRevision: this.state.revision, ...(contestSurfaceRequestID ? { contestSurfaceRequestID } : {}),
    ...(controlSurface ? {controlSurface} : {}),
  }).then(() => {});
  send = (macro: CWMacro, _previewContext?: CWContext) => this.action("send", { expectedRevision: this.state.revision, lease: this.state.lease, macroID: macro.id }).then(() => {});
  compose = async (params: CWComposeRequest): Promise<boolean> => {
    if (!this.state.armed || this.uncertain) return false;
    const value = await this.action("compose", {...params, expectedRevision: this.state.revision, lease: this.state.lease});
    return !!value && !value.error && value.composition?.jobID === params.jobID && value.composition?.appendSequence === params.appendSequence;
  };
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
/** Native applies the contest's report/cut-number policy once for both preview
 * and dispatch. Missing contest projection never silently falls back to raw fields. */
export const sharedCWContext=(state:SharedCWState):CWContext=>state.messageContext??
  (state.canonical?.contestSessionID?{}:state.canonical?.context??{});
