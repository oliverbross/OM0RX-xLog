export type RotorOwner = "native_dcu1" | "hamlib";
export type RotorSnapshot = { owner: RotorOwner | null; generation: number; state: "active" | "uncertain" | "disconnected"; intent_id?: string | null; backend?: Record<string, any> | null; backend_available?: boolean };
export type AutomaticRotorIntent = { owner: RotorOwner; generation: number; epoch: number; id: string };
export function ownAutomaticRotorMotion(intent: AutomaticRotorIntent | null, snapshot: RotorSnapshot, epoch: number, armed: boolean): boolean {
  return !!intent && armed && intent.epoch === epoch && snapshot.owner === intent.owner &&
    snapshot.generation === intent.generation + 1 && snapshot.intent_id === intent.id &&
    snapshot.state === "active" && snapshot.backend_available !== false;
}
const number = (value: unknown): number | undefined => value !== "" && value != null && Number.isFinite(Number(value)) ? Number(value) : undefined;

export function validRotorSnapshot(value: any): value is RotorSnapshot {
  return !!value && (value.owner === null || value.owner === "native_dcu1" || value.owner === "hamlib") &&
    Number.isSafeInteger(value.generation) && value.generation >= 0 && ["active", "uncertain", "disconnected"].includes(value.state);
}

export function rotorProjection(snapshot: RotorSnapshot | null): Record<string, any> {
  const backend = snapshot?.backend;
  const native = snapshot?.owner === "native_dcu1";
  const position = backend?.fields?.position;
  const azimuth = native ? number(backend?.azimuth) : number(position?.Azimuth);
  return { ...(native ? backend : {}), owner: snapshot?.owner ?? null, generation: snapshot?.generation,
    connected: snapshot?.state === "active" && snapshot.backend_available !== false && (native ? backend?.connected === true : azimuth !== undefined),
    name: native ? backend?.name || "DCU-1 rotor" : "Hamlib rotor", azimuth,
    elevation: native ? undefined : number(position?.Elevation),
    observed_at: native ? backend?.observed_at : number(backend?.observed_at_ms) === undefined ? undefined : backend!.observed_at_ms / 1000,
    status: snapshot?.state === "uncertain" ? "Connection needs attention" : native ? backend?.status || "Disconnected" : azimuth === undefined ? "Disconnected" : "Observed",
  };
}

export function rotorCommandParams(snapshot: RotorSnapshot | null, extra: Record<string, unknown> = {}) {
  if (!snapshot?.owner || !validRotorSnapshot(snapshot)) throw new Error("Select and connect a rotor first.");
  return { ...extra, owner: snapshot.owner, generation: snapshot.generation };
}

export function rotorIntentCurrent(intent: { owner: RotorOwner; generation: number }, snapshot: RotorSnapshot | null): boolean {
  return !!snapshot && snapshot.owner === intent.owner && snapshot.generation === intent.generation && rotorProjection(snapshot).connected;
}

export function clearConnectedHandoverMessage(message: string, connected: boolean): string {
  return connected && ["Previous station disconnected. Connect the selected station explicitly.", "Previous radio disconnected. Connect the selected radio explicitly."].includes(message) ? "" : message;
}
