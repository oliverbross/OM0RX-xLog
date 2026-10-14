const utf8 = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const maximumFileBytes = 32 * 1024 * 1024;

export type ADIFExportFormat = "adi" | "adx";
export type ADIFImportEncoding = "utf-8" | "windows-1252" | "iso-8859-1";
export type ADIFFieldMetadata = { version: 1; extensions: Record<string, {
  kind: "APP" | "USERDEF"; attributes: Record<string, string>; declaration?: Record<string, string>;
}> };
const sameAttributes = (left: Record<string, string>, right: Record<string, string>) =>
  Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => left[key] === right[key]);
function metadataError(): never { throw new Error("ADIF extension metadata is invalid or conflicting; no lossless conversion is available."); }
// Exact decimal comparison is bounded by the existing native field/frame limit.
// Normalized pieces are comparison-only; stored values and RANGE stay untouched.
function compareDecimal(left: string, right: string): number {
  function parts(value: string) {
    if (value.length > 16_384) metadataError();
    const negative = value.startsWith("-");
    const [whole, decimal = ""] = (negative ? value.slice(1) : value).split(".");
    const integer = whole.replace(/^0+/, "") || "0", fraction = decimal.replace(/0+$/, "");
    return { negative: negative && (integer !== "0" || fraction !== ""), integer, fraction };
  }
  const a = parts(left), b = parts(right);
  if (a.negative !== b.negative) return a.negative ? -1 : 1;
  let magnitude = a.integer.length === b.integer.length ? (a.integer < b.integer ? -1 : a.integer > b.integer ? 1 : 0) : a.integer.length < b.integer.length ? -1 : 1;
  if (!magnitude) {
    const length = Math.max(a.fraction.length, b.fraction.length);
    const first = a.fraction.padEnd(length, "0"), second = b.fraction.padEnd(length, "0");
    magnitude = first < second ? -1 : first > second ? 1 : 0;
  }
  return a.negative ? -magnitude : magnitude;
}
function extensionRange(type: string, declaration: Record<string, string>): [string, string] | undefined {
  if (declaration.RANGE === undefined) return;
  if (!["N", "I"].includes(type.toUpperCase()) || declaration.ENUM !== undefined) metadataError();
  const match = /^\{(-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)):(-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+))\}$/.exec(declaration.RANGE);
  if (!match || match[0] !== declaration.RANGE || compareDecimal(match[1], match[2]) >= 0) metadataError();
  return [match[1], match[2]];
}
function validateExtensionValue(type: string | undefined, value: string, declaration?: Record<string, string>): void {
  if (type === undefined) return;
  const normalized = type.toUpperCase();
  if (!/^[bBnNsSiIdDtTmMgGeElL]$/.test(type)) metadataError();
  if (normalized === "S" && !/^[ -~]*$/.test(value)) metadataError();
  if (normalized === "M" && !/^[\r\n -~]*$/.test(value)) metadataError();
  if (normalized === "E" && !/^[ -~]+$/.test(value)) metadataError();
  if (normalized === "B" && !/^[yn]$/i.test(value)) metadataError();
  if (normalized === "I" && !/^-?[0-9]+$/.test(value)) metadataError();
  if (normalized === "N" && !/^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(value)) metadataError();
  if (normalized === "D") validateADXValue("QSO_DATE", value);
  if (normalized === "T") validateADXValue("TIME_ON", value);
  if (normalized === "L" && !/^[EWNS](?:0[0-9]{2}|1[0-7][0-9]|180) [0-5][0-9]\.[0-9]{3}$/i.test(value)) metadataError();
  if (!["G", "M"].includes(normalized) && /[\r\n]/.test(value)) metadataError();
  if (declaration?.ENUM !== undefined && (!/^\{[ -~]*\}$/.test(declaration.ENUM) || /[\r\n]/.test(declaration.ENUM) || normalized !== "E" || !declaration.ENUM.slice(1, -1).split(",").includes(value))) metadataError();
  const range = declaration && extensionRange(type, declaration);
  if (range && (compareDecimal(value, range[0]) < 0 || compareDecimal(value, range[1]) > 0)) metadataError();
}
function validateFieldMetadata(metadata: ADIFFieldMetadata, fields: Map<string, string>): void {
  if (!metadata || metadata.version !== 1 || !metadata.extensions || typeof metadata.extensions !== "object" || Array.isArray(metadata.extensions) ||
    Object.keys(metadata).some(key => !["version", "extensions"].includes(key)) || Object.keys(metadata.extensions).length > 128 || utf8.encode(JSON.stringify(metadata)).length > 16_384) metadataError();
  const ids = new Set<string>();
  for (const [key, item] of Object.entries(metadata.extensions)) {
    if (!item || !item.attributes || typeof item.attributes !== "object" || Array.isArray(item.attributes) ||
      Object.keys(item).some(name => !["kind", "attributes", "declaration"].includes(name)) ||
      Object.values(item.attributes).some(value => typeof value !== "string") || !/^[A-Z0-9_]+$/.test(key)) metadataError();
    const { attributes, declaration } = item;
    if (!/^[A-Za-z0-9_]+$/.test(attributes.FIELDNAME ?? "")) metadataError();
    if (item.kind === "APP") {
      if (!/^[A-Za-z0-9_]+$/.test(attributes.PROGRAMID ?? "") || key !== `APP_${attributes.PROGRAMID}_${attributes.FIELDNAME}`.toUpperCase() ||
        !fields.has(key) || declaration !== undefined || Object.keys(attributes).some(name => !["PROGRAMID", "FIELDNAME", "TYPE"].includes(name))) metadataError();
      validateExtensionValue(attributes.TYPE, fields.get(key)!);
    } else {
      if (item.kind !== "USERDEF" || key !== attributes.FIELDNAME.toUpperCase() || key.startsWith("APP_") || standardADXFields.has(key) || reservedADXFields.has(key) || Object.keys(attributes).length !== 1 || !declaration) metadataError();
      if (Object.values(declaration).some(value => typeof value !== "string") || Object.keys(declaration).some(name => !["FIELDID", "TYPE", "ENUM", "RANGE"].includes(name)) ||
        !/^[1-9][0-9]{0,9}$/.test(declaration.FIELDID ?? "") || Number(declaration.FIELDID) > 4294967295 || ids.has(declaration.FIELDID) || !/^[bBnNsSiIdDtTmMgGeElL]$/.test(declaration.TYPE ?? "")) metadataError();
      ids.add(declaration.FIELDID);
      extensionRange(declaration.TYPE, declaration);
      if (declaration.ENUM !== undefined && (!/^\{[ -~]*\}$/.test(declaration.ENUM) || /[\r\n]/.test(declaration.ENUM) || declaration.TYPE.toUpperCase() !== "E")) metadataError();
      if (fields.has(key)) validateExtensionValue(declaration.TYPE, fields.get(key)!, declaration);
    }
  }
}

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

// Bounded scalar subset of ADIF 3.1.7 adx317.xsd, shared by both directions.
// Preserve accepted lexical text exactly; never round through JS floating point.
// This does not claim full XSD validation (including all string/enumeration types).
const adxDateFields = new Set(`QSO_DATE QSO_DATE_OFF QSLRDATE QSLSDATE LOTW_QSLRDATE LOTW_QSLSDATE
EQSL_QSLRDATE EQSL_QSLSDATE DCL_QSLRDATE DCL_QSLSDATE CLUBLOG_QSO_UPLOAD_DATE HAMLOGEU_QSO_UPLOAD_DATE
HAMQTH_QSO_UPLOAD_DATE HRDLOG_QSO_UPLOAD_DATE QRZCOM_QSO_DOWNLOAD_DATE QRZCOM_QSO_UPLOAD_DATE`.split(/\s+/));
const adxReceivedFields = new Set(["QSL_RCVD", "LOTW_QSL_RCVD", "EQSL_QSL_RCVD", "DCL_QSL_RCVD"]);
const adxSentFields = new Set(["QSL_SENT", "LOTW_QSL_SENT", "EQSL_QSL_SENT", "DCL_QSL_SENT"]);
const potaReferencePattern = "[A-Za-z0-9]{1,4}-[0-9]{4,5}(?:@[A-Za-z]{2}-[A-Za-z0-9]{1,3})?";
const adxPatternRules = [
  { fields: ["GRIDSQUARE", "MY_GRIDSQUARE"], pattern: /^[A-R]{2}(?:[0-9]{2}(?:[A-X]{2}(?:[0-9]{2})?)?)?$/i },
  { fields: ["GRIDSQUARE_EXT", "MY_GRIDSQUARE_EXT"], pattern: /^[A-X]{2}(?:[0-9]{2})?$/i },
  { fields: ["IOTA", "MY_IOTA"], pattern: /^(?:NA|SA|EU|AF|OC|AS|AN)-(?!000$)[0-9]{3}$/i },
  { fields: ["SOTA_REF", "MY_SOTA_REF"], pattern: /^[A-Z0-9]{1,8}\/[A-Z]{2}-(?!000$)[0-9]{3}$/i },
  { fields: ["POTA_REF", "MY_POTA_REF"], pattern: new RegExp(`^${potaReferencePattern}(?:,${potaReferencePattern})*$`) },
  { fields: ["WWFF_REF", "MY_WWFF_REF"], pattern: /^[A-Z0-9]{1,4}FF-[0-9]{4}$/i },
  { fields: ["DARC_DOK", "MY_DARC_DOK"], pattern: /^[0-9A-Z]+$/i },
  { fields: ["CONT"], pattern: /^(?:NA|SA|EU|AF|OC|AS|AN)$/i },
  { fields: ["ANT_PATH"], pattern: /^[GOSL]$/i },
];
function validateADXValue(name: string, value: string): void {
  let valid = true;
  const patternRule = adxPatternRules.find(rule => rule.fields.includes(name));
  if (patternRule) valid = patternRule.pattern.test(value);
  else if (["FREQ", "FREQ_RX", "TX_PWR", "RX_PWR"].includes(name)) {
    valid = /^-?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/.test(value);
    if (["TX_PWR", "RX_PWR"].includes(name) && value.startsWith("-")) valid &&= /^-0*(?:\.0*)?$/.test(value);
  } else if (["DXCC", "MY_DXCC"].includes(name)) {
    valid = /^(?:0|[1-9][0-9]{0,2})$/.test(value) && Number(value) <= 522;
  } else if (["CQZ", "MY_CQ_ZONE", "ITUZ", "MY_ITU_ZONE"].includes(name)) {
    const digits = value.replace(/^0+/, "");
    valid = /^[0-9]+$/.test(value) && digits.length > 0 && digits.length <= 2 && Number(digits) <= (name.includes("CQ") ? 40 : 90);
  } else if (adxDateFields.has(name)) {
    valid = /^(?:19[3-9][0-9]|[2-9][0-9]{3})(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])$/.test(value);
    if (valid) {
      const year = Number(value.slice(0, 4)), month = Number(value.slice(4, 6)), day = Number(value.slice(6, 8));
      valid = new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
    }
  } else if (["TIME_ON", "TIME_OFF"].includes(name)) valid = /^(?:[01][0-9]|2[0-3])(?:[0-5][0-9]){1,2}$/.test(value);
  else if (adxReceivedFields.has(name)) valid = /^[ynri]$/i.test(value);
  else if (adxSentFields.has(name)) valid = /^[ynrqi]$/i.test(value);
  else if (["QSL_SENT_VIA", "QSL_RCVD_VIA"].includes(name)) valid = /^[bde]$/i.test(value);
  else if (["SWL", "QSO_RANDOM", "FORCE_INIT", "SILENT_KEY"].includes(name)) valid = /^[yn]$/i.test(value);
  else return;
  // JS '$' also matches before a final newline; scalar/reference values must
  // consume the entire field rather than accepting an unvalidated line ending.
  if (!valid || /[\r\n]/.test(value)) throw new Error(`Field ${name} has an invalid ADX typed value. Use ADI to preserve non-schema values.`);
}

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
  private declarations = new Map<string, { name: string; attributes: Record<string, string> }>();
  private bytes = 0;
  private records = 0;
  private failed = false;
  constructor(readonly format: ADIFExportFormat, private readonly maximumBytes = maximumFileBytes) {}

  append(text: string, expectedRecords: number, fieldMetadata?: (ADIFFieldMetadata | null)[]): void {
    if (this.failed) throw new Error("Export has already stopped.");
    try {
      if (!Number.isSafeInteger(expectedRecords) || expectedRecords <= 0) throw new Error("Frozen export record count could not be verified.");
      if (fieldMetadata && (!Array.isArray(fieldMetadata) || fieldMetadata.length !== expectedRecords ||
        fieldMetadata.some(value => value !== null && (typeof value !== "object" || Array.isArray(value))))) metadataError();
      if (this.format === "adi" && fieldMetadata?.some(Boolean)) throw new Error("ADX extension metadata requires ADX export for lossless preservation.");
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
            const metadata = fieldMetadata?.[count];
            if (metadata) {
              validateFieldMetadata(metadata, fields);
              for (const [key, extension] of Object.entries(metadata.extensions)) {
                if (extension.kind !== "USERDEF") continue;
                const next = { name: extension.attributes.FIELDNAME, attributes: { ...extension.declaration! } };
                const existing = this.declarations.get(key);
                if (existing && (existing.name !== next.name || !sameAttributes(existing.attributes, next.attributes))) metadataError();
                if ([...this.declarations].some(([other, value]) => other !== key && value.attributes.FIELDID === next.attributes.FIELDID)) metadataError();
                this.declarations.set(key, next);
              }
            }
            const record: string[] = [];
            for (const [name, value] of fields) {
              validateADXValue(name, value);
              const escaped = xmlText(value);
              const extension = metadata?.extensions[name];
              if (extension) {
                const attributes = Object.entries(extension.attributes).map(([key, value]) => ` ${key}="${xmlText(value)}"`).join("");
                record.push(`<${extension.kind}${attributes}>${escaped}</${extension.kind}>`);
              } else if (name.startsWith("APP_")) {
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
    const declarations = [...this.declarations.values()];
    const usedIDs = new Set(declarations.map(item => item.attributes.FIELDID));
    let nextID = 1;
    for (const name of this.customFields) {
      if (this.declarations.has(name)) metadataError();
      while (usedIDs.has(String(nextID))) nextID++;
      declarations.push({ name, attributes: { FIELDID: String(nextID), TYPE: "G" } }); usedIDs.add(String(nextID++));
    }
    if (declarations.length > 128) metadataError();
    const header = this.format === "adx" ? '<?xml version="1.0" encoding="UTF-8"?>\r\n<ADX><HEADER><ADIF_VER>3.1.7</ADIF_VER><PROGRAMID>OM0RX-xLog</PROGRAMID>' +
      declarations.map(item => `<USERDEF${Object.entries(item.attributes).map(([key, value]) => ` ${key}="${xmlText(value)}"`).join("")}>${xmlText(item.name)}</USERDEF>`).join("") + '</HEADER><RECORDS>\r\n' : "";
    const footer = this.format === "adx" ? "</RECORDS></ADX>\r\n" : "";
    if (this.bytes + utf8.encode(header + footer).length > this.maximumBytes) throw new Error("Export exceeds the 32 MiB file limit.");
    return header + this.parts.join("") + footer;
  }
}

export function decodeADIFDocument(bytes: ArrayBuffer, encoding: ADIFImportEncoding = "utf-8"): { text: string; fieldMetadata: (ADIFFieldMetadata | null)[] } {
  const fieldMetadata: (ADIFFieldMetadata | null)[] = [];
  return { text: decodeADIF(bytes, encoding, fieldMetadata), fieldMetadata };
}

/** Bound the metadata sidecar as well as the canonical ADI in each native frame. */
export function adifImportBatches(document: { text: string; fieldMetadata: (ADIFFieldMetadata | null)[] }): { text: string; fieldMetadata?: (ADIFFieldMetadata | null)[] }[] {
  const counts: number[] = [];
  const texts = adifBatches(document.text, 14_000, counts);
  const result: { text: string; fieldMetadata?: (ADIFFieldMetadata | null)[] }[] = [];
  function append(text: string, metadata: (ADIFFieldMetadata | null)[]) {
    if (!metadata.some(Boolean)) { result.push({ text }); return; }
    if (utf8.encode(JSON.stringify(metadata)).length <= 16_384) { result.push({ text, fieldMetadata: metadata }); return; }
    if (metadata.length === 1) throw new Error("ADIF extension metadata exceeds the native frame limit.");
    const subCounts: number[] = [];
    const parts = adifBatches(text, 14_000, subCounts, Math.ceil(metadata.length / 2));
    let offset = 0;
    parts.forEach((part, index) => { append(part, metadata.slice(offset, offset + subCounts[index])); offset += subCounts[index]; });
  }
  if (document.fieldMetadata.length && document.fieldMetadata.length !== counts.reduce((sum, value) => sum + value, 0)) metadataError();
  let offset = 0;
  texts.forEach((text, index) => { append(text, document.fieldMetadata.slice(offset, offset + counts[index])); offset += counts[index]; });
  return result;
}

export function decodeADIF(bytes: ArrayBuffer, encoding: ADIFImportEncoding = "utf-8", fieldMetadata?: (ADIFFieldMetadata | null)[]): string {
  if (bytes.byteLength > 32 * 1024 * 1024) throw new Error("Choose an ADIF file smaller than 32 MiB.");
  if (encoding !== "utf-8" && encoding !== "windows-1252" && encoding !== "iso-8859-1") throw new Error("Choose a supported import encoding.");
  if (encoding !== "utf-8") return legacyADI(new Uint8Array(bytes), encoding);
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new Error("Only UTF-8 ADI or ADX files are supported. Export UTF-8 and try again.");
  }
  if (text.includes("\0")) throw new Error("Only UTF-8 ADI or ADX files are supported. Export UTF-8 and try again.");
  return /^\s*<(?:\?|!|(?:[A-Za-z_][\w.-]*:)?ADX(?:\s|\/?>))/.test(text) ? adxToADI(text, fieldMetadata) : text;
}

// Explicit Windows-1252 mapping: browser decoders may accept its undefined bytes,
// and ISO-8859-1 decoder labels are aliases for Windows-1252 in the web runtime.
// ISO-8859-1 maps each byte to the identical Unicode code point, including C1
// controls. Field text preserves those through native ADI/JSON persistence.
// Every mapped character occupies one source byte, so source descriptor lengths
// remain usable until each field is rewritten with its canonical UTF-8 length.
function legacyADI(bytes: Uint8Array, encoding: Exclude<ADIFImportEncoding, "utf-8">): string {
  const controls = [0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
    0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
    0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
    0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178];
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; start += 8192) {
    const points = Array.from(bytes.subarray(start, start + 8192), byte => {
      const point = encoding === "windows-1252" && byte >= 0x80 && byte <= 0x9f ? controls[byte - 0x80] : byte;
      if (!point) throw new Error(encoding === "windows-1252"
        ? "Windows-1252 input contains an undefined byte or NUL. Export UTF-8 and try again."
        : "ISO-8859-1 input contains NUL. Export UTF-8 and try again.");
      return point;
    });
    chunks.push(String.fromCharCode(...points));
  }
  const text = chunks.join("");
  if (/^\s*<(?:\?|!|(?:[A-Za-z_][\w.-]*:)?ADX(?:\s|\/?>))/.test(text)) {
    throw new Error("ADX requires UTF-8. Choose UTF-8 import encoding and a UTF-8 ADX file.");
  }
  let cursor = text.indexOf("<"), size = 0;
  if (cursor < 0) throw new Error("No ADIF descriptors were found.");
  const output: string[] = [];
  function append(part: string) {
    size += utf8.encode(part).length;
    if (size > maximumFileBytes) throw new Error("Converted ADI exceeds the 32 MiB import limit.");
    output.push(part);
  }
  append(text.slice(0, cursor));
  while (cursor < text.length) {
    const whitespace = /^[\t\n\r ]+/.exec(text.slice(cursor))?.[0];
    if (whitespace) { append(whitespace); cursor += whitespace.length; continue; }
    const close = text.indexOf(">", cursor);
    if (text[cursor] !== "<" || close < 0) throw new Error("ADIF contains an invalid or unfinished descriptor.");
    const descriptor = text.slice(cursor + 1, close);
    cursor = close + 1;
    if (/^(EOH|EOR)$/i.test(descriptor)) { append(`<${descriptor.toUpperCase()}>`); continue; }
    const match = /^([A-Z0-9_]+):([0-9]+)(?::([A-Z]))?$/i.exec(descriptor);
    const length = match ? Number(match[2]) : NaN;
    if (!match || !Number.isSafeInteger(length) || length > text.length - cursor) throw new Error("ADIF contains an invalid or truncated field.");
    const value = text.slice(cursor, cursor + length);
    append(`<${match[1].toUpperCase()}:${utf8.encode(value).length}${match[3] ? `:${match[3].toUpperCase()}` : ""}>`);
    append(value); cursor += length;
  }
  return output.join("");
}

// Normalize ADX at the file boundary so the worker reviews and freezes exactly
// the same byte-counted ADI that its existing import/update paths already use.
function adxToADI(text: string, fieldMetadata?: (ADIFFieldMetadata | null)[]): string {
  const declaration = /^\s*<\?xml\s[^?]*\?>/.exec(text)?.[0];
  const encoding = declaration && /\bencoding\s*=\s*['"]([^'"]+)['"]/.exec(declaration)?.[1];
  if (encoding && !/^utf-8$/i.test(encoding)) throw new Error("ADX must declare UTF-8 encoding. Export UTF-8 and try again.");
  // Reject before parsing: no DTD, external resources or custom entities.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw new Error("ADX document types and entity declarations are unsupported.");
  const document = new DOMParser().parseFromString(text, "application/xml");
  const fail = (): never => { throw new Error("ADX contains invalid or unsupported XML structure or fields."); };
  if (document.getElementsByTagName("parsererror").length) fail();
  const root = document.documentElement;
  const headerFields = new Set(["ADIF_VER", "CREATED_TIMESTAMP", "PROGRAMID", "PROGRAMVERSION"]);
  // Retain the existing uniform-namespace import compatibility, but never
  // reinterpret a foreign vocabulary (including xmlns="" resets) as ADIF.
  function vocabulary(element: Element): void {
    if (element.namespaceURI !== root.namespaceURI) fail();
  }
  function container(element: Element, schemaHints = false): void {
    vocabulary(element);
    if (Array.from(element.attributes).some(attribute =>
      attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/" && !(schemaHints &&
        attribute.namespaceURI === "http://www.w3.org/2001/XMLSchema-instance" &&
        ["schemaLocation", "noNamespaceSchemaLocation"].includes(attribute.localName)))) fail();
    // Schema hints are advisory only: never fetch schemas or external resources.
  }
  function children(element: Element): Element[] {
    if (Array.from(element.childNodes).some(node =>
      (node.nodeType === 3 && /[^\t\r\n ]/.test(node.textContent ?? "")) || node.nodeType === 4)) fail();
    return Array.from(element.children);
  }
  function field(element: Element, header = false): [string, string] {
    vocabulary(element);
    if (element.children.length) fail();
    let name = element.localName;
    if (header ? !headerFields.has(name) && name !== "USERDEF" : !standardADXFields.has(name) && !["APP", "USERDEF"].includes(name)) fail();
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
    if (element.hasAttribute("TYPE") && !/^[bBnNsSiIdDtTmMgGeElL]$/.test(element.getAttribute("TYPE")!)) fail();
    name = name.toUpperCase();
    if (!/^[A-Z0-9_]+$/.test(name) || ["EOH", "EOR", "ADX", "HEADER", "RECORDS", "RECORD", "APP", "USERDEF"].includes(name)) fail();
    if (!header) validateADXValue(name, element.textContent ?? "");
    return [name, element.textContent ?? ""];
  }
  if (root.localName !== "ADX") fail();
  container(root, true);
  const sections = children(root);
  if (sections.length !== 2 || sections[0].localName !== "HEADER" || sections[1].localName !== "RECORDS") fail();
  sections.forEach(section => container(section));
  const declarations = new Map<string, { name: string; attributes: Record<string, string> }>();
  const declarationIDs = new Set<string>();
  const seenHeaderFields = new Set<string>();
  for (const entry of children(sections[0])) {
    field(entry, true);
    if (entry.localName !== "USERDEF") {
      if (seenHeaderFields.has(entry.localName)) fail();
      seenHeaderFields.add(entry.localName);
      continue;
    }
    const name = entry.textContent ?? "", key = name.toUpperCase();
    const attributes = Object.fromEntries(Array.from(entry.attributes).filter(attribute => !attribute.namespaceURI).map(attribute => [attribute.name, attribute.value]));
    if (declarations.has(key) || declarationIDs.has(attributes.FIELDID)) metadataError();
    declarations.set(key, { name, attributes }); declarationIDs.add(attributes.FIELDID);
  }
  const records = children(sections[1]);
  if (!records.length) throw new Error("No complete ADIF records were found.");
  const result: string[] = [];
  let size = 0;
  for (const record of records) {
    if (record.localName !== "RECORD") fail();
    container(record);
    const fields = children(record);
    if (!fields.length || fields.length > 128) fail();
    const seen = new Set<string>();
    const metadata: ADIFFieldMetadata = { version: 1, extensions: Object.fromEntries([...declarations].map(([key, value]) => [key,
      { kind: "USERDEF", attributes: { FIELDNAME: value.name }, declaration: value.attributes }])) };
    const body = fields.map(element => {
      const [name, value] = field(element);
      if (seen.has(name)) throw new Error(`ADX repeats field ${name}; importing would lose data.`);
      seen.add(name);
      if (element.localName === "APP") {
        if (metadata.extensions[name]) metadataError();
        metadata.extensions[name] = { kind: "APP", attributes: Object.fromEntries(Array.from(element.attributes).filter(attribute => !attribute.namespaceURI).map(attribute => [attribute.name, attribute.value])) };
      } else if (element.localName === "USERDEF") {
        if (metadata.extensions[name]?.attributes.FIELDNAME !== element.getAttribute("FIELDNAME")) metadataError();
      } else if (metadata.extensions[name]) metadataError();
      return `<${name}:${utf8.encode(value).length}>${value}`;
    }).join("") + "<EOR>\r\n";
    if (Object.keys(metadata.extensions).length) {
      validateFieldMetadata(metadata, new Map(fields.map(element => field(element))));
      fieldMetadata?.push(metadata);
    } else fieldMetadata?.push(null);
    size += utf8.encode(body).length;
    size += Object.keys(metadata.extensions).length ? utf8.encode(JSON.stringify(metadata)).length : 0;
    if (size > 32 * 1024 * 1024) throw new Error("Converted ADX exceeds the 32 MiB import limit.");
    result.push(body);
  }
  return result.join("");
}

// Descriptor lengths are UTF-8 bytes, matching the native xLog ADI writer.
// EOR-like text inside a length-delimited field must never split a record.
export function adifBatches(text: string, maximumBytes = 14_000, recordCounts?: number[], maximumRecords = 100): string[] {
  if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1 || maximumRecords > 100) throw new Error("Invalid ADIF batch record limit.");
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
      if (records === maximumRecords || cursor - batchStart > maximumBytes) {
        batches.push(decoder.decode(bytes.subarray(batchStart, start)));
        recordCounts?.push(records);
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
  if (records) { batches.push(decoder.decode(bytes.subarray(batchStart))); recordCounts?.push(records); }
  if (!batches.length) throw new Error("No complete ADIF records were found.");
  return batches;
}
