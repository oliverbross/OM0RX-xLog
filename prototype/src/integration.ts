import { spots, type QSO } from "./model";

// Entity metadata belongs to these synthetic fixtures only, not a callsign resolver.
const entities: Record<string, number> = {
  "United States": 291, Finland: 224, Australia: 150, Japan: 339, "Solomon Islands": 185,
};
export type Classification = {
  id: string; call: string; frequency_hz: number; band: string; mode: string;
  call_status: string; dxcc_status: string; score: number;
};
export function clusterBatch(qsos: QSO[]) {
  return {
    history_scope: "synthetic_session",
    spots: spots.map(s => ({ id: s.id, line: `DX de ${s.reporter}: ${(s.mhz * 1000).toFixed(3)} ${s.call} ${s.mode} ${s.note}`, adif: entities[s.country] })),
    contacts: qsos.map(q => {
      const fixture = spots.find(s => s.call === q.call);
      // The Swift domain rules derive the actual logged band from this frequency.
      return { callsign: q.call, frequency_hz: Math.round(Number(q.frequency) * 1_000_000), mode: q.mode, adif: fixture ? entities[fixture.country] : null,
        timestamp: Date.parse(q.time) / 1000 };
    }),
  };
}
export function decodeClassifications(result: unknown): Record<string, Classification> {
  const value = result as { schema_version?: number; history_scope?: string; station_io?: boolean; spots?: Classification[] } | null;
  if (value?.schema_version !== 1 || value.history_scope !== "synthetic_session" || value.station_io !== false ||
      !Array.isArray(value.spots) || value.spots.length !== spots.length) throw new Error("Invalid cluster classification response");
  const output: Record<string, Classification> = {};
  for (const row of value.spots) {
    const input = spots.find(s => s.id === row.id);
    if (!input || output[row.id] || row.call !== input.call || row.frequency_hz !== Math.round(input.mhz * 1_000_000) ||
        typeof row.call_status !== "string" || typeof row.dxcc_status !== "string" || !Number.isFinite(row.score))
      throw new Error("Cluster classification did not match its input");
    output[row.id] = row;
  }
  return output;
}
export function opportunityLabel(value: Classification | undefined): string {
  if (!value) return "—";
  if (value.dxcc_status === "ATNO") return "ATNO";
  const labels: Record<string, string> = {
    "New Call": "NC", "New Band+Mode": "NB+NM", "New Band": "NB", "New Mode": "NM", Confirmed: "CFM", Worked: "WKD",
  };
  return labels[value.call_status] ?? "—";
}
export function classificationTone(value: Classification | undefined): string {
  if (!value) return "secondary";
  return value.call_status === "Confirmed" ? "confirmed" : value.call_status === "Worked" ? "worked" : "needed";
}
