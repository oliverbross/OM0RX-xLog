import { describe, expect, it } from "vitest";
import { LARGE_LOG_RECORDS, largeLogADIFBatch } from "../src/acceptanceFixture";

describe("bounded generated large-log fixture", () => {
  it("fits the shipping import contract at both ends of the data set", () => {
    expect(LARGE_LOG_RECORDS).toBe(100_000);
    for (const offset of [0, 1984, 65_536, LARGE_LOG_RECORDS - 64]) {
      const batch = largeLogADIFBatch(offset, 64);
      expect(new TextEncoder().encode(batch).length).toBeLessThanOrEqual(16_384);
      expect(batch.match(/<EOR>/g)).toHaveLength(64);
      expect(new Set(batch.split("<EOR>").filter(Boolean)).size).toBe(64);
    }
    expect(largeLogADIFBatch(0, 1)).toContain("<CALL:5>DL1T0");
    expect(largeLogADIFBatch(2000, 1)).toContain("<CALL:5>DL1T0");
    expect(largeLogADIFBatch(2000, 1)).not.toBe(largeLogADIFBatch(0, 1));
  });
  it("rejects arbitrary sizes and invalid ranges", () => {
    for (const [offset, count] of [[-1, 1], [0, 0], [0, 65], [0.5, 1], [0, 1.5], [LARGE_LOG_RECORDS, 1], [NaN, 1]]) {
      expect(() => largeLogADIFBatch(offset, count)).toThrow();
    }
  });
});
