// Generated test data only; never read an operator logbook to build a benchmark.
export const LARGE_LOG_RECORDS = 100_000;
const entities = [["DL1T", "230"], ["K1T", "291"], ["JA1T", "339"], ["BY1T", "318"],
  ["OM1T", "504"], ["VK1T", "150"], ["G1T", "223"], ["PY1T", "108"]] as const;
const tag = (name: string, value: string) => `<${name}:${value.length}>${value}`;

export function largeLogADIFBatch(offset: number, count: number): string {
  if (!Number.isInteger(offset) || !Number.isInteger(count) || offset < 0 || count < 1 || count > 64 || offset + count > LARGE_LOG_RECORDS) {
    throw new Error("Invalid acceptance fixture range");
  }
  return Array.from({ length: count }, (_, row) => {
    const index = offset + row;
    const [prefix, dxcc] = entities[index % entities.length];
    const instant = new Date(Date.UTC(2020, 0, 1) + index * 60_000).toISOString();
    return tag("CALL", `${prefix}${(index % 2000).toString(36).toUpperCase()}`) +
      tag("QSO_DATE", instant.slice(0, 10).replaceAll("-", "")) + tag("TIME_ON", instant.slice(11, 19).replaceAll(":", "")) +
      tag("BAND", ["20m", "40m", "15m"][index % 3]) + tag("MODE", ["CW", "SSB", "FT8"][index % 3]) +
      tag("DXCC", dxcc) + tag("QSL_RCVD", index % 2 ? "N" : "Y") + tag("COMMENT", "Generated performance fixture") + "<EOR>";
  }).join("");
}
