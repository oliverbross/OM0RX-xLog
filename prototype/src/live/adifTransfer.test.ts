import { expect, it } from "vitest";
import { adifBatches, decodeADIF } from "./adifTransfer";

it("rejects malformed UTF-8 instead of replacing the invalid bytes", () => {
  expect(() => decodeADIF(new Uint8Array([60, 67, 65, 76, 76, 58, 49, 62, 0xff]).buffer)).toThrow("Only UTF-8 ADI");
  expect(decodeADIF(new TextEncoder().encode("<COMMENT:2>é<EOR>").buffer)).toContain("é");
});
it.each(["<?xml version='1.0'?><ADX/>", "<ADX/>"])("rejects unsupported ADX %s", text => {
  expect(() => decodeADIF(new TextEncoder().encode(text).buffer)).toThrow("ADX and other encodings");
});

it("keeps UTF-8 and EOR-looking field values in their length-delimited records", () => {
  const text = "<COMMENT:10>é<EOR>abc<EOR>\r\n";
  expect(adifBatches(text)).toEqual([text]);
});
it("batches only complete records with byte and record bounds", () => {
  const record = "<CALL:4>W1AW<EOR>";
  expect(adifBatches(record.repeat(101))).toEqual([record.repeat(100), record]);
  expect(adifBatches(record.repeat(2), 20)).toEqual([record, record]);
  expect(() => adifBatches(record, 10)).toThrow("safe import size");
});
it.each(["no records", "<CALL:4>W1", "<CALL:4>W1AW", "<CALL:x>W1AW<EOR>"])("rejects incomplete or malformed input %s", text => {
  expect(() => adifBatches(text)).toThrow();
});
