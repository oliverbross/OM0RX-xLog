/** Display to 100 Hz; the original numeric frequency remains the tune target. */
export function formatSpotFrequency(frequencyHz: number): string {
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) return "—";
  const tenthsKHz = Math.round(frequencyHz / 100);
  return `${Math.floor(tenthsKHz / 10_000)}.${String(Math.floor(tenthsKHz / 10) % 1000).padStart(3, "0")}.${tenthsKHz % 10}`;
}
