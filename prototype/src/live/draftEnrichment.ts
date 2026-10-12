type Data = Record<string, any>;
const contactFields = ["name", "gridSquare", "country", "dxcc", "continent", "cqZone", "ituZone", "state", "county", "qth", "email", "iota", "sotaReference", "potaReference", "wwffReference", "sig", "sigInfo"];
export const normalizedCall = (value: unknown) => String(value || "").trim().toUpperCase();

// A new callsign is a new contact: never carry another station's identity into it.
// Keep fields explicitly supplied by a spot and all unrelated log/ADIF metadata.
export function changedCallDraft(previous: Data | null, next: Data | null): Data | null {
  if (!previous || !next || previous.id !== next.id || normalizedCall(previous.call) === normalizedCall(next.call)) return next;
  const result = { ...next };
  for (const key of contactFields) if (result[key] === previous[key]) result[key] = key === "dxcc" ? null : "";
  return result;
}

export function enrichedDraft(current: Data | null, baseline: Data, lookup: Data): Data | null {
  if (!current || current.id !== baseline.id || normalizedCall(current.call) !== normalizedCall(baseline.call) ||
      normalizedCall(lookup.call) !== normalizedCall(current.call)) return current;
  const result = { ...current };
  for (const key of contactFields) {
    const value = lookup[key];
    if (value == null || value === "") continue;
    // Canonical country/entity resolve stale restored metadata, but never replace
    // an operator's edit made while this request was in flight.
    const canonical = ["country", "dxcc", "continent", "cqZone", "ituZone"].includes(key);
    const unchanged = current[key] === baseline[key];
    if (unchanged && (current[key] == null || current[key] === "" || canonical)) result[key] = value;
  }
  return result;
}
