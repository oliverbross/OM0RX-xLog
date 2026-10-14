const utf8 = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function decodeADIF(bytes: ArrayBuffer): string {
  if (bytes.byteLength > 32 * 1024 * 1024) throw new Error("Choose an ADIF file smaller than 32 MiB.");
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new Error("Only UTF-8 ADI or ADX files are supported. Export UTF-8 and try again.");
  }
  if (text.includes("\0")) throw new Error("Only UTF-8 ADI or ADX files are supported. Export UTF-8 and try again.");
  return /^\s*<(?:\?|!|(?:[A-Za-z_][\w.-]*:)?ADX(?:\s|\/?>))/.test(text) ? adxToADI(text) : text;
}

// Normalize ADX at the file boundary so the worker reviews and freezes exactly
// the same byte-counted ADI that its existing import/update paths already use.
function adxToADI(text: string): string {
  const declaration = /^\s*<\?xml\s[^?]*\?>/.exec(text)?.[0];
  const encoding = declaration && /\bencoding\s*=\s*['"]([^'"]+)['"]/.exec(declaration)?.[1];
  if (encoding && !/^utf-8$/i.test(encoding)) throw new Error("ADX must declare UTF-8 encoding. Export UTF-8 and try again.");
  // Reject before parsing: no DTD, external resources or custom entities.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw new Error("ADX document types and entity declarations are unsupported.");
  const document = new DOMParser().parseFromString(text, "application/xml");
  const fail = (): never => { throw new Error("ADX contains invalid or unsupported XML structure or fields."); };
  if (document.getElementsByTagName("parsererror").length) fail();
  function children(element: Element): Element[] {
    if (Array.from(element.childNodes).some(node =>
      (node.nodeType === 3 && node.textContent?.trim()) || node.nodeType === 4)) fail();
    return Array.from(element.children);
  }
  function field(element: Element, header = false): [string, string] {
    if (element.children.length) fail();
    let name = element.localName;
    let attributes: string[] = [];
    if (name === "APP") {
      const program = element.getAttribute("PROGRAMID"), fieldName = element.getAttribute("FIELDNAME");
      if (!program || !fieldName) fail();
      name = `APP_${program}_${fieldName}`;
      attributes = ["PROGRAMID", "FIELDNAME", "TYPE"];
    } else if (name === "USERDEF") {
      attributes = header ? ["FIELDID", "TYPE", "ENUM", "RANGE"] : ["FIELDNAME"];
      name = header ? `USERDEF${element.getAttribute("FIELDID") ?? ""}` : element.getAttribute("FIELDNAME") ?? "";
      if (header && !/^[1-9][0-9]*$/.test(element.getAttribute("FIELDID") ?? "")) fail();
    }
    if (Array.from(element.attributes).some(attribute => attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/" && !attributes.includes(attribute.name))) fail();
    if (element.hasAttribute("TYPE") && !/^[A-Za-z]$/.test(element.getAttribute("TYPE")!)) fail();
    name = name.toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(name) || ["EOH", "EOR", "ADX", "HEADER", "RECORDS", "RECORD", "APP", "USERDEF"].includes(name)) fail();
    return [name, element.textContent ?? ""];
  }
  const root = document.documentElement;
  if (root.localName !== "ADX") fail();
  const sections = children(root);
  if (sections.length !== 2 || sections[0].localName !== "HEADER" || sections[1].localName !== "RECORDS") fail();
  // Header metadata is validated but not mapped into contact fields, as with ADI.
  for (const entry of children(sections[0])) field(entry, true);
  const records = children(sections[1]);
  if (!records.length) throw new Error("No complete ADIF records were found.");
  const result: string[] = [];
  let size = 0;
  for (const record of records) {
    if (record.localName !== "RECORD") fail();
    const fields = children(record);
    if (!fields.length || fields.length > 128) fail();
    const seen = new Set<string>();
    const body = fields.map(element => {
      const [name, value] = field(element);
      if (seen.has(name)) throw new Error(`ADX repeats field ${name}; importing would lose data.`);
      seen.add(name);
      return `<${name}:${utf8.encode(value).length}>${value}`;
    }).join("") + "<EOR>\r\n";
    size += utf8.encode(body).length;
    if (size > 32 * 1024 * 1024) throw new Error("Converted ADX exceeds the 32 MiB import limit.");
    result.push(body);
  }
  return result.join("");
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
