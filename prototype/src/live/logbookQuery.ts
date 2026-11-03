export type LogbookClause = { field: string; op: string; values: string[] };
export type LogbookQuery = { version: 1; join: "all" | "any"; clauses: LogbookClause[] };
export const emptyLogbookQuery = (): LogbookQuery => ({ version: 1, join: "all", clauses: [] });
export const logbookQueryFields = [
  ["stationCall", "Station callsign"], ["operatorCall", "Operator callsign"], ["ownDXCC", "Recorded own DXCC"],
  ["ownLocation", "Recorded own location"], ["ownGrid", "Recorded own grid"], ["call", "Contact callsign"],
  ["dxcc", "DXCC"], ["band", "Band"], ["mode", "Stored mode (SSB is SSB only)"], ["submode", "Submode"],
  ["modeGroup", "Mode group (CW / Phone / Data)"], ["date", "UTC start time"], ["power", "Transmit power (W)"],
  ["paper", "Paper QSL received"], ["lotw", "LoTW received"], ["eqsl", "eQSL received"], ["qslRoute", "QSL route"],
  ["continent", "Recorded continent"], ["cqZone", "Recorded CQ zone"], ["ituZone", "Recorded ITU zone"],
  ["iota", "Contact IOTA"], ["pota", "Contact POTA"], ["sota", "Contact SOTA"], ["wwff", "Contact WWFF"],
  ["ownIota", "Own IOTA"], ["ownPota", "Own POTA"], ["ownSota", "Own SOTA"], ["ownWWFF", "Own WWFF"],
  ["ownActivation", "Own activation reference"], ["portableContext", "Portable session"], ["grid", "Contact grid"], ["state", "Contact state"],
] as const;
const numeric = new Set(["dxcc", "ownDXCC", "power", "cqZone", "ituZone"]);
export function logbookOperators(field: string): [string, string][] {
  const ordinary: [string, string][] = [["eq", "equals"], ["ne", "does not equal"]];
  return [...ordinary, ...(field === "date" ? [["between", "UTC interval"], ["relative", "UTC period"]] as [string, string][]
    : numeric.has(field) ? [["in", "one of"], ["gt", "greater than"], ["gte", "at least"], ["lt", "less than"], ["lte", "at most"], ["between", "range"]] as [string, string][]
    : [["in", "one of"], ["contains", "contains literal text"], ["starts", "starts with literal text"]] as [string, string][]),
  ["set", "is set"], ["unset", "is not set"]];
}
export function parseLogbookQuery(value: unknown): LogbookQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid saved contact filter.");
  const q = value as LogbookQuery;
  if (q.version !== 1 || !["all", "any"].includes(q.join) || !Array.isArray(q.clauses) || q.clauses.length > 24) throw new Error("Unsupported contact filter version or size.");
  for (const clause of q.clauses) {
    if (!clause || !logbookQueryFields.some(([field]) => field === clause.field) || !logbookOperators(clause.field).some(([op]) => op === clause.op) ||
      !Array.isArray(clause.values) || clause.values.length > 32 || clause.values.some(v => typeof v !== "string" || new TextEncoder().encode(v).length > 256 || v.includes("\0")))
      throw new Error("Invalid saved contact filter condition.");
  }
  return q;
}
export function logbookQuerySummary(query: LogbookQuery) {
  if (!query.clauses.length) return "All contacts; quick search applies separately.";
  return `Match ${query.join}: ` + query.clauses.map(c => `${logbookQueryFields.find(([f]) => f === c.field)?.[1] ?? c.field} ${logbookOperators(c.field).find(([op]) => op === c.op)?.[1] ?? c.op} ${c.values.join(" / ")}`).join(query.join === "all" ? "; and " : "; or ");
}
