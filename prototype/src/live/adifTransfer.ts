const utf8 = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const maximumFileBytes = 32 * 1024 * 1024;

export type ADIFExportFormat = "adi" | "adx";

// QSO element names from the ADIF 3.1.7 ADX schema. Unknown preserved names
// are declared USERDEF fields rather than invented XML elements.
// https://www.adif.org/317/adx317.xsd
const standardADXFields = new Set(`ADDRESS ADDRESS_INTL AGE ALTITUDE A_INDEX ANT_AZ ANT_EL ANT_PATH ARRL_SECT
AWARD_SUBMITTED AWARD_GRANTED BAND BAND_RX CALL CHECK CLASS CLUBLOG_QSO_UPLOAD_DATE CLUBLOG_QSO_UPLOAD_STATUS
CNTY CNTY_ALT COMMENT COMMENT_INTL CONT CONTACTED_OP CONTEST_ID COUNTRY COUNTRY_INTL CQZ CREDIT_SUBMITTED CREDIT_GRANTED
DARC_DOK DCL_QSLRDATE DCL_QSLSDATE DCL_QSL_RCVD DCL_QSL_SENT DISTANCE DXCC EMAIL EQ_CALL EQSL_AG EQSL_QSLRDATE
EQSL_QSLSDATE EQSL_QSL_RCVD EQSL_QSL_SENT FISTS FISTS_CC FORCE_INIT FREQ FREQ_RX GRIDSQUARE GRIDSQUARE_EXT
HAMLOGEU_QSO_UPLOAD_DATE HAMLOGEU_QSO_UPLOAD_STATUS HAMQTH_QSO_UPLOAD_DATE HAMQTH_QSO_UPLOAD_STATUS
HRDLOG_QSO_UPLOAD_DATE HRDLOG_QSO_UPLOAD_STATUS IOTA IOTA_ISLAND_ID ITUZ K_INDEX LAT LON LOTW_QSLRDATE LOTW_QSLSDATE
LOTW_QSL_RCVD LOTW_QSL_SENT MAX_BURSTS MODE MORSE_KEY_INFO MORSE_KEY_TYPE MS_SHOWER MY_ALTITUDE MY_ANTENNA MY_ANTENNA_INTL
MY_ARRL_SECT MY_CITY MY_CITY_INTL MY_CNTY MY_CNTY_ALT MY_COUNTRY MY_COUNTRY_INTL MY_CQ_ZONE MY_DARC_DOK MY_DXCC MY_FISTS
MY_GRIDSQUARE MY_GRIDSQUARE_EXT MY_IOTA MY_IOTA_ISLAND_ID MY_ITU_ZONE MY_LAT MY_LON MY_MORSE_KEY_INFO MY_MORSE_KEY_TYPE
MY_NAME MY_NAME_INTL MY_POSTAL_CODE MY_POSTAL_CODE_INTL MY_POTA_REF MY_RIG MY_RIG_INTL MY_SIG MY_SIG_INTL MY_SIG_INFO
MY_SIG_INFO_INTL MY_SOTA_REF MY_STATE MY_STREET MY_STREET_INTL MY_USACA_COUNTIES MY_VUCC_GRIDS MY_WWFF_REF NAME NAME_INTL
NOTES NOTES_INTL NR_BURSTS NR_PINGS OPERATOR OWNER_CALLSIGN PFX POTA_REF PRECEDENCE PROP_MODE PUBLIC_KEY
QRZCOM_QSO_DOWNLOAD_DATE QRZCOM_QSO_DOWNLOAD_STATUS QRZCOM_QSO_UPLOAD_DATE QRZCOM_QSO_UPLOAD_STATUS QSLMSG QSLMSG_INTL
QSLMSG_RCVD QSLRDATE QSLSDATE QSL_RCVD QSL_RCVD_VIA QSL_SENT QSL_SENT_VIA QSL_VIA QSO_COMPLETE QSO_DATE QSO_DATE_OFF
QSO_RANDOM QTH QTH_INTL REGION RIG RIG_INTL RST_RCVD RST_SENT RX_PWR SAT_MODE SAT_NAME SFI SIG SIG_INTL SIG_INFO
SIG_INFO_INTL SILENT_KEY SKCC SOTA_REF SRX SRX_STRING STATE STATION_CALLSIGN STX STX_STRING SUBMODE SWL TEN_TEN
TIME_OFF TIME_ON TX_PWR UKSMG USACA_COUNTIES VUCC_GRIDS WEB WWFF_REF`.split(/\s+/));
const reservedADXFields = new Set(["EOH", "EOR", "ADX", "HEADER", "RECORDS", "RECORD", "APP", "USERDEF", "ADIF_VER", "CREATED_TIMESTAMP", "PROGRAMID", "PROGRAMVERSION"]);

function validateXMLText(value: string): void {
  // XML 1.0 cannot represent these values, even as character references. Reject
  // unpaired surrogates too, before TextEncoder could replace them silently.
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (!(code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff))) {
      throw new Error("A field cannot be represented losslessly in XML. Choose ADI export instead.");
    }
  }
}

function xmlText(value: string): string {
  validateXMLText(value);
  // Character references preserve CR exactly through XML newline normalization.
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/\r/g, "&#13;");
}

/** One bounded document assembled only from frozen native export frames. */
export class ADIFExportDocument {
  private parts: string[] = [];
  private customFields = new Set<string>();
  private bytes = 0;
  private records = 0;
  private failed = false;
  constructor(readonly format: ADIFExportFormat, private readonly maximumBytes = maximumFileBytes) {}

  append(text: string, expectedRecords: number): void {
    if (this.failed) throw new Error("Export has already stopped.");
    try {
      if (!Number.isSafeInteger(expectedRecords) || expectedRecords <= 0) throw new Error("Frozen export record count could not be verified.");
      if (this.format === "adx") validateXMLText(text);
      const input = utf8.encode(text);
      if (input.length > this.maximumBytes) throw new Error("Export exceeds the 32 MiB file limit.");
      let body = text;
      if (this.format === "adx") {
        let cursor = 0, count = 0, headerEnded = false;
        let fields = new Map<string, string>();
        const output: string[] = [];
        while (cursor < input.length) {
          if ([9, 10, 13, 32].includes(input[cursor])) { cursor++; continue; }
          const close = input.indexOf(62, cursor);
          if (input[cursor] !== 60 || close < 0) throw new Error("Frozen export contains an invalid ADI descriptor.");
          const descriptor = decoder.decode(input.subarray(cursor + 1, close)).toUpperCase();
          cursor = close + 1;
          if (descriptor === "EOH") {
            if (headerEnded || count || this.records || [...fields.keys()].some(name => name !== "ADIF_VER")) {
              throw new Error("Frozen export contains unsupported header metadata.");
            }
            headerEnded = true; fields = new Map(); continue;
          }
          if (descriptor === "EOR") {
            if (!fields.size) throw new Error("Frozen export contains an empty record.");
            const record: string[] = [];
            for (const [name, value] of fields) {
              const escaped = xmlText(value);
              if (name.startsWith("APP_")) {
                const match = /^APP_([A-Z0-9]+)_([A-Z0-9_]+)$/.exec(name);
                if (!match) throw new Error(`Field ${name} cannot be represented losslessly in ADX. Choose ADI export instead.`);
                record.push(`<APP PROGRAMID="${match[1]}" FIELDNAME="${match[2]}" TYPE="G">${escaped}</APP>`);
              } else if (standardADXFields.has(name)) record.push(`<${name}>${escaped}</${name}>`);
              else {
                if (reservedADXFields.has(name)) throw new Error(`Field ${name} conflicts with ADX structure. Choose ADI export instead.`);
                this.customFields.add(name);
                if (this.customFields.size > 128) throw new Error("ADX export exceeds the custom field definition limit. Choose ADI export instead.");
                record.push(`<USERDEF FIELDNAME="${name}">${escaped}</USERDEF>`);
              }
            }
            output.push(`<RECORD>${record.join("")}</RECORD>\r\n`);
            count++; fields = new Map(); continue;
          }
          const match = /^([A-Z0-9_]+):([0-9]+)$/.exec(descriptor);
          const length = match ? Number(match[2]) : NaN;
          if (!match || !Number.isSafeInteger(length) || length > input.length - cursor || fields.has(match[1]) || fields.size >= 128) {
            throw new Error("Frozen export contains an unsupported, repeated or truncated field. Choose ADI export instead.");
          }
          const value = decoder.decode(input.subarray(cursor, cursor + length));
          fields.set(match[1], value); cursor += length;
        }
        if (fields.size || count !== expectedRecords) throw new Error("Frozen export record count could not be verified.");
        body = output.join("");
      }
      this.bytes += utf8.encode(body).length;
      if (this.bytes > this.maximumBytes) throw new Error("Export exceeds the 32 MiB file limit.");
      this.parts.push(body); this.records += expectedRecords;
    } catch (error) { this.failed = true; throw error; }
  }

  finish(): string {
    if (this.failed || !this.records) throw new Error("Export is incomplete.");
    const header = this.format === "adx" ? '<?xml version="1.0" encoding="UTF-8"?>\r\n<ADX><HEADER><ADIF_VER>3.1.7</ADIF_VER><PROGRAMID>OM0RX-xLog</PROGRAMID>' +
      [...this.customFields].map((name, index) => `<USERDEF FIELDID="${index + 1}" TYPE="G">${name}</USERDEF>`).join("") + '</HEADER><RECORDS>\r\n' : "";
    const footer = this.format === "adx" ? "</RECORDS></ADX>\r\n" : "";
    if (this.bytes + utf8.encode(header + footer).length > this.maximumBytes) throw new Error("Export exceeds the 32 MiB file limit.");
    return header + this.parts.join("") + footer;
  }
}

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
