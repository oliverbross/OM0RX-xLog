export type SpotActivationBarrier = { barrierId: string; operationId: string; generation: string;
  draftId: string; expectedRevision: number; deadline: number };
export type SpotEditorReadiness = { ready: boolean; reason?: string };
export const spotActivationFrozenMessage = "Spot activation is checking the shared editors. Your text is retained; wait for its verified outcome.";
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export const validSpotOperation = uuid;
export function validSpotActivationBarrier(value: any): value is SpotActivationBarrier {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    [value.barrierId, value.operationId, value.generation].every(uuid) && typeof value.draftId === "string" &&
    value.draftId.length > 0 && value.draftId.length <= 64 && !value.draftId.includes("\0") &&
    Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0 &&
    Number.isFinite(value.deadline) && value.deadline > 0;
}

/** Independent of action locks: a late Save/restore finally cannot unfreeze it. */
export class SpotEditorFence {
  private registered = true;
  private operation: string | null = null;
  get frozen() { return !this.registered || this.operation !== null; }
  get operationId() { return this.operation; }
  setRegistered(value: boolean) { this.registered = value; }
  freeze(operationId: string): boolean {
    if (!uuid(operationId)) { this.registered = false; return false; }
    if (this.operation && this.operation !== operationId) return false;
    this.operation = operationId;
    return true;
  }
  matches(operationId: string) { return this.registered && this.operation === operationId; }
  release(operationId: string): boolean {
    if (!this.matches(operationId)) return false;
    this.operation = null;
    return true;
  }
  assertWritable() { if (this.frozen) throw new Error(spotActivationFrozenMessage); }
}
