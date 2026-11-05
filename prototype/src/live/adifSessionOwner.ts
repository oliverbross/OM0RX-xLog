type Request = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

/** One UI owner's exact native session, including replies arriving after Close.
 * Retire waits for admitted users; it never targets the worker's latest session. */
export class ADIFSessionOwner {
  private coordinates: { token: string; generation: string } | null = null;
  private users = 0;
  private closed = false;
  private sent = false;

  constructor(private request: Request, private method: "logbook_import_adif" | "logbook_export_adif") {}
  get active() { return !this.closed; }

  bind(token: unknown, generation: unknown) {
    if (typeof token !== "string" || !token || typeof generation !== "string" || !generation)
      throw new Error("The ADIF session could not be verified. Review it again.");
    if (this.coordinates && (this.coordinates.token !== token || this.coordinates.generation !== generation))
      throw new Error("The ADIF session changed. Review it again.");
    this.coordinates = { token, generation };
    this.flush();
  }

  hold() {
    if (this.closed) throw new Error("The ADIF session is closed. Review it again.");
    this.users++;
    let released = false;
    return () => {
      if (released) return;
      released = true; this.users--; this.flush();
    };
  }

  retire() { this.closed = true; this.flush(); }
  private flush() {
    if (!this.closed || this.users || !this.coordinates || this.sent) return;
    this.sent = true;
    const coordinates = this.coordinates;
    // An unavailable transport still has the worker's bounded expiry fallback.
    void Promise.resolve().then(() => this.request(this.method, { action: "retire", ...coordinates })).catch(() => {});
  }
}
