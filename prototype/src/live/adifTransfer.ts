const utf8 = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function decodeADIF(bytes: ArrayBuffer): string {
  try {
    const text = decoder.decode(bytes);
    if (text.trimStart().startsWith("<?xml") || text.trimStart().startsWith("<ADX")) throw new Error("ADX");
    return text;
  } catch {
    throw new Error("Only UTF-8 ADI files are supported. ADX and other encodings are unsupported; export UTF-8 ADI and try again.");
  }
}

// Descriptor lengths are UTF-8 bytes, matching the native xLog ADI writer.
// EOR-like text inside a length-delimited field must never split a record.
export function adifBatches(text: string, maximumBytes = 14_000): string[] {
  const bytes = utf8.encode(text);
  if (bytes.length > 32 * 1024 * 1024) throw new Error("Choose an ADIF file smaller than 32 MiB.");
  const batches: string[] = [];
  let cursor = bytes.indexOf(60), start = 0, batchStart = 0, records = 0;
  if (cursor < 0) throw new Error("No ADIF descriptors were found.");
  while (cursor < bytes.length) {
    if ([9, 10, 13, 32].includes(bytes[cursor])) { cursor++; continue; }
    const close = bytes.indexOf(62, cursor);
    if (bytes[cursor] !== 60 || close < 0) throw new Error("ADIF contains an invalid or unfinished descriptor.");
    const descriptor = decoder.decode(bytes.subarray(cursor + 1, close));
    cursor = close + 1;
    if (/^EOH$/i.test(descriptor)) continue;
    if (/^EOR$/i.test(descriptor)) {
      if (cursor - start > maximumBytes) throw new Error("An ADIF record exceeds the safe import size.");
      if (records === 100 || cursor - batchStart > maximumBytes) {
        batches.push(decoder.decode(bytes.subarray(batchStart, start)));
        batchStart = start; records = 0;
      }
      start = cursor; records++;
      continue;
    }
    const match = /^[A-Z0-9_]+:([0-9]+)(?::[A-Z])?$/i.exec(descriptor);
    const length = match ? Number(match[1]) : NaN;
    if (!Number.isSafeInteger(length) || length > bytes.length - cursor) throw new Error("ADIF contains an invalid or truncated field.");
    cursor += length;
  }
  if (decoder.decode(bytes.subarray(start)).trim()) throw new Error("ADIF ends with an incomplete record.");
  if (records) batches.push(decoder.decode(bytes.subarray(batchStart)));
  if (!batches.length) throw new Error("No complete ADIF records were found.");
  return batches;
}
