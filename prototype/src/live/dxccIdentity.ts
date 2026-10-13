type Data = Record<string, unknown>;
export type DXCCIdentity = { label: string; status: "neutral" | "confirmed" | "worked" | "new" };
const call = (value: unknown) => typeof value === "string" ? value.trim().toUpperCase() : "";
const count = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// Lookup identifies the entity; only the complete, matching local entity history
// can classify it. Neither a lookup's isNewCall nor a truncated QSO list can.
export function dxccIdentity(currentCall: unknown, lookup?: Data | null, history?: Data | null): DXCCIdentity {
  const current = call(currentCall);
  if (!current || call(lookup?.call) !== current) return { label: "Country unresolved", status: "neutral" };
  const country = typeof lookup?.country === "string" ? lookup.country.trim() : "";
  const adif = typeof lookup?.dxcc === "number" && Number.isSafeInteger(lookup.dxcc) && lookup.dxcc > 0 ? lookup.dxcc : null;
  const identity: DXCCIdentity = { label: adif === null ? country || "Country unresolved" : country ? `${country} · DXCC ${adif}` : `DXCC ${adif}`, status: "neutral" };
  if (!country || adif === null || call(history?.call) !== current || history?.adif !== adif || !Array.isArray(history.matrix)) return identity;
  const worked = history.dxcc_contact_count, confirmed = history.dxcc_confirmed_count;
  if (!count(worked) || !count(confirmed) || confirmed > worked) return identity;
  return { ...identity, status: confirmed > 0 ? "confirmed" : worked > 0 ? "worked" : "new" };
}
