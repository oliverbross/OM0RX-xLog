// @vitest-environment jsdom
import { expect, it } from "vitest";
import { adifBatches, adifImportBatches, decodeADIF, decodeADIFDocument, ADIFExportDocument } from "./adifTransfer";

it("rejects malformed UTF-8 instead of replacing the invalid bytes", () => {
  expect(() => decodeADIF(new Uint8Array([60, 67, 65, 76, 76, 58, 49, 62, 0xff]).buffer)).toThrow("Only UTF-8 ADI or ADX");
  expect(decodeADIF(new TextEncoder().encode("<COMMENT:2>é<EOR>").buffer)).toContain("é");
});

const legacyBytes = (text: string) => {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index++) bytes[index] = text.charCodeAt(index);
  return bytes.buffer;
};
it("decodes only explicitly selected Windows-1252 and rewrites lengths before batching", () => {
  const source = "Legacy export\r\n<ADIF_VER:5>3.1.7<EOH>\r\n<COMMENT:11:S>\x8eilina<EOR><NOTES:0><CUSTOM:4>\x80\x93\xe9\xff<EOR>\r\n";
  expect(() => decodeADIF(legacyBytes(source))).toThrow("Only UTF-8");
  const canonical = decodeADIF(legacyBytes(source), "windows-1252");
  expect(canonical).toBe("Legacy export\r\n<ADIF_VER:5>3.1.7<EOH>\r\n<COMMENT:12:S>Žilina<EOR><NOTES:0><CUSTOM:10>€“éÿ<EOR>\r\n");
  expect(adifBatches(canonical)).toEqual([canonical]);
});

it.each([0x81, 0x8d, 0x8f, 0x90, 0x9d, 0])("rejects undefined Windows-1252 bytes and NUL: %s", byte => {
  expect(() => decodeADIF(legacyBytes(`<NOTES:1>${String.fromCharCode(byte)}<EOR>`), "windows-1252")).toThrow("undefined byte or NUL");
});

it("maps every non-NUL ISO-8859-1 byte to its identical Unicode code point, including all C1 controls", () => {
  const value = String.fromCharCode(...Array.from({ length: 255 }, (_, index) => index + 1));
  const canonical = decodeADIF(legacyBytes(`<NOTES:255>${value}<EOR>`), "iso-8859-1");
  expect(canonical).toBe(`<NOTES:383>${value}<EOR>`);
  expect(adifBatches(canonical)).toEqual([canonical]);
  expect(decodeADIF(legacyBytes("<COMMENT:1>\x80<EOR>"), "iso-8859-1")).toBe("<COMMENT:2>\u0080<EOR>");
  expect(decodeADIF(legacyBytes("<COMMENT:1>\x80<EOR>"), "windows-1252")).toBe("<COMMENT:3>€<EOR>");
  expect(() => decodeADIF(legacyBytes("<NOTES:1>\0<EOR>"), "iso-8859-1")).toThrow("ISO-8859-1 input contains NUL");
});

it("enforces ISO-8859-1 source, expanded output, record and batch bounds", () => {
  const record = "<COMMENT:1>\xe9<EOR>";
  const canonical = decodeADIF(legacyBytes(record.repeat(101)), "iso-8859-1");
  expect(adifBatches(canonical)).toEqual(["<COMMENT:2>é<EOR>".repeat(100), "<COMMENT:2>é<EOR>"]);
  expect(() => adifBatches(decodeADIF(legacyBytes(`<COMMENT:7000>${"\xe9".repeat(7000)}<EOR>`), "iso-8859-1"))).toThrow("safe import size");
  expect(() => decodeADIF(new ArrayBuffer(32 * 1024 * 1024 + 1), "iso-8859-1")).toThrow("smaller than 32 MiB");
  const value = "\xff".repeat(16 * 1024 * 1024);
  expect(() => decodeADIF(legacyBytes(`<COMMENT:${value.length}>${value}<EOR>`), "iso-8859-1")).toThrow("Converted ADI exceeds");
  expect(() => decodeADIF(legacyBytes("<COMMENT:99>short<EOR>"), "iso-8859-1")).toThrow("truncated field");
  expect(() => decodeADIF(legacyBytes("<ADX/>"), "iso-8859-1")).toThrow("ADX requires UTF-8");
});

it("preserves ISO-8859-1 C1 field text through UTF-8 ADX export and reimport", () => {
  const controls = String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index + 0x80));
  const canonical = decodeADIF(legacyBytes(`<NOTES_INTL:32>${controls}<EOR>\r\n`), "iso-8859-1");
  const writer = new ADIFExportDocument("adx");
  writer.append(canonical, 1);
  expect(decodeADIF(new TextEncoder().encode(writer.finish()).buffer)).toBe(canonical);
});

it.each(["<COMMENT:99>short<EOR>", "<COMMENT:-1>x<EOR>", "<COMMENT:1:SS>x<EOR>", "<COMMENT:1>x<EOR>trailing", "<COMMENT:1>x<>"])("rejects malformed legacy descriptors: %s", source => {
  expect(() => decodeADIF(legacyBytes(source), "windows-1252")).toThrow();
});

it("preserves legacy record counts and applies bounds after UTF-8 expansion", () => {
  const record = "<COMMENT:1>\x80<EOR>";
  const canonical = decodeADIF(legacyBytes(record.repeat(101)), "windows-1252");
  expect(adifBatches(canonical)).toEqual(["<COMMENT:3>€<EOR>".repeat(100), "<COMMENT:3>€<EOR>"]);
  expect(() => adifBatches(decodeADIF(legacyBytes(`<COMMENT:7000>${"\x80".repeat(7000)}<EOR>`), "windows-1252"))).toThrow("safe import size");
  expect(() => decodeADIF(new ArrayBuffer(32 * 1024 * 1024 + 1), "windows-1252")).toThrow("smaller than 32 MiB");
  const value = "\xff".repeat(16 * 1024 * 1024);
  expect(() => decodeADIF(legacyBytes(`<COMMENT:${value.length}>${value}<EOR>`), "windows-1252")).toThrow("Converted ADI exceeds");
});

it.each(["<ADX/>", "<?xml version='1.0'?><ADX/>", "<a:ADX xmlns:a='urn:adif'/>"])("keeps ADX UTF-8-only when legacy decoding is selected: %s", source => {
  expect(() => decodeADIF(legacyBytes(source), "windows-1252")).toThrow("ADX requires UTF-8");
});
it.each(["<?xml version='1.0'?><ADX/>", "<ADX/>"])("rejects incomplete ADX %s", text => {
  expect(() => decodeADIF(new TextEncoder().encode(text).buffer)).toThrow("invalid or unsupported XML");
});

const decode = (text: string) => decodeADIF(new TextEncoder().encode(text).buffer);
const adx = (fields: string, header = "<ADIF_VER>3.1.7</ADIF_VER>") => `<ADX><HEADER>${header}</HEADER><RECORDS><RECORD>${fields}</RECORD></RECORDS></ADX>`;

it.each(["C4FM", "DSTAR", "c4fm", "dstar", "PSK31", "psk31", "PSK63", "psk63", "PSK63F", "psk63f", "PSK125", "psk125", "PSKAM10", "pskam10"])("imports raw deprecated ADX MODE %s without rewriting fields or metadata", mode => {
  const source = adx(`<CALL>W1AW</CALL><QSO_DATE>20261016</QSO_DATE><TIME_ON>123456</TIME_ON>` +
    `<BAND>2m</BAND><MODE>${mode}</MODE><FREQ>145.500000</FREQ><BAND_RX>70cm</BAND_RX><FREQ_RX>433.500000</FREQ_RX>` +
    '<COMMENT_INTL>Žilina 😀</COMMENT_INTL><USERDEF FIELDNAME="Mixed_Custom">未知</USERDEF>' +
    '<APP PROGRAMID="Mixed_App" FIELDNAME="Opaque_Name" TYPE="g">é &lt;EOR&gt;</APP>',
  '<ADIF_VER>3.1.8</ADIF_VER><USERDEF FIELDID="17" TYPE="g">Mixed_Custom</USERDEF>');
  const imported = decodeADIFDocument(new TextEncoder().encode(source).buffer);
  const expected = adiRecord({ CALL: "W1AW", QSO_DATE: "20261016", TIME_ON: "123456", BAND: "2m", MODE: mode,
    FREQ: "145.500000", BAND_RX: "70cm", FREQ_RX: "433.500000", COMMENT_INTL: "Žilina 😀",
    MIXED_CUSTOM: "未知", APP_MIXED_APP_OPAQUE_NAME: "é <EOR>" });
  expect(imported.text).toBe(expected);
  expect(imported.text).not.toContain("<SUBMODE:");
  expect(imported.fieldMetadata).toEqual([{ version: 1, extensions: {
    MIXED_CUSTOM: { kind: "USERDEF", attributes: { FIELDNAME: "Mixed_Custom" }, declaration: { FIELDID: "17", TYPE: "g" } },
    APP_MIXED_APP_OPAQUE_NAME: { kind: "APP", attributes: { PROGRAMID: "Mixed_App", FIELDNAME: "Opaque_Name", TYPE: "g" } },
  } }]);
  expect(adifImportBatches(imported)).toEqual([{ text: expected, fieldMetadata: imported.fieldMetadata }]);
  expect(decodeADIFDocument(new TextEncoder().encode(source).buffer)).toEqual(imported);
  // Only native QSO export may canonicalize these imported fields.
  const writer = new ADIFExportDocument("adx");
  expect(() => writer.append(imported.text, 1, imported.fieldMetadata)).toThrow("Field MODE has an invalid ADX typed value");
  expect(imported.text).toBe(expected);
});

it.each(["C4FM", "DSTAR", "c4fm", "dstar", "PSK31", "psk31", "PSK63", "psk63", "PSK63F", "psk63f", "PSK125", "psk125", "PSKAM10", "pskam10"].flatMap(mode => ["C4FM", "DSTAR", "FutureVoice"].map(submode => ({ mode, submode }))))(
  "preserves explicit raw ADX MODE $mode / SUBMODE $submode on import", ({ mode, submode }) => {
    const imported = decode(adx(`<MODE>${mode}</MODE><SUBMODE>${submode}</SUBMODE>`));
    expect(imported).toBe(adiRecord({ MODE: mode, SUBMODE: submode }));
  });

it.each(["C4FM ", " DSTAR", "C4FM\n", "DSTAR\t", "C4FM2", "D-STAR", "PSK31 ", " PSK31", "PSK31\n", "PSK31\t", "PSK312", "PSK63 ", " PSK63", "PSK63\n", "PSK63\t", "PSK632", "PSK63F ", " PSK63F", "PSK63F\n", "PSK63F\t", "PSK63F2", "PSK125 ", " PSK125", "PSK125\n", "PSK125\t", "PSK1252", "PSKAM10 ", " PSKAM10", "PSKAM10\n", "PSKAM10\t", "PSKAM102", "FutureVoice", ""])(
  "keeps strict raw ADX MODE validation for invalid value %s", mode => {
    expect(() => decode(adx(`<MODE>${mode}</MODE>`))).toThrow("Field MODE has an invalid ADX typed value");
  });

it.each(["C4FM", "DSTAR", "PSK31", "PSK63", "PSK63F", "PSK125", "PSKAM10"])("still rejects repeated raw ADX MODE fields with deprecated %s", mode => {
  expect(() => decode(adx(`<MODE>${mode}</MODE><MODE>DIGITALVOICE</MODE>`))).toThrow("ADX repeats field MODE");
});

it.each(["C4FM", "DSTAR", "c4fm", "dstar", "PSK31", "psk31", "PSK63", "psk63", "PSK63F", "psk63f", "PSK125", "psk125", "PSKAM10", "pskam10"])("retains native normalized deprecated mode %s output through ADI and ADX", submode => {
  // ADIF 3.1.8 Deprecation, Mode and Submode Enumerations:
  // https://adif.org.uk/318/ADIF_318.htm#Deprecation
  const mode = ["PSK31", "PSK63", "PSK63F", "PSK125", "PSKAM10"].includes(submode.toUpperCase()) ? "PSK" : "DIGITALVOICE";
  const source = `<CALL:4>W1AW<MODE:${mode.length}>${mode}<SUBMODE:${submode.length}>${submode}<COMMENT_INTL:2>é<EOR>\r\n`;
  const imported = decodeADIFDocument(new TextEncoder().encode(source).buffer);
  for (const format of ["adi", "adx"] as const) {
    const writer = new ADIFExportDocument(format);
    writer.append(imported.text, 1);
    const result = writer.finish();
    const reparsed = decodeADIFDocument(new TextEncoder().encode(result).buffer);
    expect(reparsed.text).toBe(imported.text);
    expect(reparsed.fieldMetadata.every(value => value === null)).toBe(true);
    if (format === "adx") expect(result).toContain("<ADIF_VER>3.1.7</ADIF_VER>");
  }
});

it.each(["SKCC-SKS", "SKCC-SKSA", "SKCC-SKSE", "SKCC-WES"])("preserves ADIF 3.1.8 JTTY, contest %s, region and station/RX fields through ADX", contest => {
  // Released 2026-10-12: https://adif.org.uk/318/ADIF_318.htm
  const fields = `<CALL>W1AW</CALL><MODE>MFSK</MODE><SUBMODE>JTTY</SUBMODE><CONTEST_ID>${contest}</CONTEST_ID><REGION>ET</REGION>` +
    '<STATION_CALLSIGN>OM0RX</STATION_CALLSIGN><OPERATOR>K1ABC</OPERATOR><BAND>20m</BAND><FREQ>14.025000</FREQ>' +
    '<BAND_RX>40m</BAND_RX><FREQ_RX>7.025000</FREQ_RX><TX_PWR>100</TX_PWR><RX_PWR>50</RX_PWR>' +
    '<COMMENT_INTL>Žilina 😀</COMMENT_INTL><APP PROGRAMID="OTHER" FIELDNAME="OPAQUE" TYPE="G">é &lt;EOR&gt;</APP>';
  const imported = decodeADIFDocument(new TextEncoder().encode(adx(fields, "<ADIF_VER>3.1.8</ADIF_VER>")).buffer);
  const writer = new ADIFExportDocument("adx");
  writer.append(imported.text, 1, imported.fieldMetadata);
  expect(decodeADIFDocument(new TextEncoder().encode(writer.finish()).buffer)).toEqual(imported);
  expect(imported.text).toContain("<SUBMODE:4>JTTY");
  expect(imported.text).toContain(`<CONTEST_ID:${contest.length}>${contest}`);
});

it("accepts generic-schema ADX header scalar values", () => {
  const header = "<ADIF_VER>3.1.7</ADIF_VER><CREATED_TIMESTAMP>20261014 015959</CREATED_TIMESTAMP>" +
    "<PROGRAMID>OM0RX xLog</PROGRAMID><PROGRAMVERSION>0.4.0-alpha.24</PROGRAMVERSION>";
  expect(decode(adx("<CALL>W1AW</CALL>", header))).toBe("<CALL:4>W1AW<EOR>\r\n");
});

it.each([
  "<ADIF_VER>3.1.17</ADIF_VER>",
  "<CREATED_TIMESTAMP>20261301 000000</CREATED_TIMESTAMP>",
  "<CREATED_TIMESTAMP>20261014T015959</CREATED_TIMESTAMP>",
  "<PROGRAMID>OM0RX Žilina</PROGRAMID>",
  "<PROGRAMVERSION>alpha\t24</PROGRAMVERSION>",
])("rejects ADX header values outside the generic schema: %s", header => {
  expect(() => decode(adx("<CALL>W1AW</CALL>", header))).toThrow("invalid ADX schema value");
});

it("converts UTF-8 ADX text, empty fields and extensions into exact byte-counted ADI", () => {
  const converted = decode("\uFEFF<?xml version='1.0' encoding='UTF-8'?>" + adx(
    "<CALL>W1AW</CALL><COMMENT_INTL>Žilina &amp; &lt;EOR&gt; 😀</COMMENT_INTL><NOTES/>" +
    '<APP PROGRAMID="TEST" FIELDNAME="OPAQUE" TYPE="S">value</APP><USERDEF FIELDNAME="CUSTOM">é</USERDEF>',
    '<USERDEF FIELDID="1" TYPE="G">CUSTOM</USERDEF>'));
  const comment = "Žilina & <EOR> 😀";
  expect(converted).toBe(`<CALL:4>W1AW<COMMENT_INTL:${new TextEncoder().encode(comment).length}>${comment}<NOTES:0><APP_TEST_OPAQUE:5>value<CUSTOM:2>é<EOR>\r\n`);
  expect(adifBatches(converted)).toEqual([converted]);
});

it("keeps record order and uses the existing bounded batcher for ADX", () => {
  const xml = `<ADX><HEADER/><RECORDS>${"<RECORD><CALL>W1AW</CALL></RECORD>".repeat(101)}</RECORDS></ADX>`;
  const batches = adifBatches(decode(xml));
  expect(batches).toHaveLength(2);
  expect(batches[1].trim()).toBe("<CALL:4>W1AW<EOR>");
  expect(() => adifBatches(decode(adx(`<COMMENT>${"x".repeat(14_001)}</COMMENT>`)))).toThrow("safe import size");
});

it("accepts XML namespaces, comments, processing instructions and CDATA field text", () => {
  expect(decode('<a:ADX xmlns:a="urn:adif"><a:HEADER/><!-- metadata --><a:RECORDS><?export value?><a:RECORD><a:COMMENT_INTL><![CDATA[<EOR> & é]]></a:COMMENT_INTL></a:RECORD></a:RECORDS></a:ADX>'))
    .toBe("<COMMENT_INTL:10><EOR> & é<EOR>\r\n");
});

it("retains uniform namespace aliases, advisory schema hints and exact extension metadata", () => {
  const source = '<a:ADX xmlns:a="urn:adif" xmlns:b="urn:adif" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:adif https://example.invalid/never-fetch.xsd">\n' +
    '<b:HEADER><a:USERDEF FIELDID="17" TYPE="g">Mixed_Custom</a:USERDEF></b:HEADER>\t<b:RECORDS>\r\n<b:RECORD>' +
    '<a:COMMENT_INTL>Žilina 😀</a:COMMENT_INTL><b:USERDEF FIELDNAME="Mixed_Custom">未知</b:USERDEF>' +
    '<a:APP PROGRAMID="Mixed_App" FIELDNAME="Opaque_Name" TYPE="g">é</a:APP></b:RECORD></b:RECORDS></a:ADX>';
  const imported = decodeADIFDocument(new TextEncoder().encode(source).buffer);
  const writer = new ADIFExportDocument("adx"); writer.append(imported.text, 1, imported.fieldMetadata);
  expect(decodeADIFDocument(new TextEncoder().encode(writer.finish()).buffer)).toEqual(imported);
  expect(decode(adx("<CALL>W1AW</CALL>").replace("<ADX>", '<ADX xmlns:s="http://www.w3.org/2001/XMLSchema-instance" s:noNamespaceSchemaLocation="https://example.invalid/never-fetch.xsd">')))
    .toBe(adiRecord({ CALL: "W1AW" }));
});

it.each([
  adx("<CUSTOM>silently reclassified</CUSTOM>"),
  adx("<call>W1AW</call>"),
  adx("<ADIF_VER>3.1.7</ADIF_VER>"),
  adx("<CALL>W1AW</CALL>", "<CALL>lost</CALL>"),
  adx("<CALL>W1AW</CALL>", '<APP PROGRAMID="TEST" FIELDNAME="LOST">value</APP>'),
  ...["ADIF_VER", "CREATED_TIMESTAMP", "PROGRAMID", "PROGRAMVERSION"].map(name =>
    adx("<CALL>W1AW</CALL>", `<${name}>first</${name}><${name}>second</${name}>`)),
  ...["ADX", "HEADER", "RECORDS", "RECORD"].map(name =>
    adx("<CALL>W1AW</CALL>").replace(`<${name}>`, `<${name} unknown="lost">`)),
  adx("<CALL>W1AW</CALL>").replace("<ADX>", '<ADX xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:nil="true">'),
  adx("<CALL>W1AW</CALL>").replace("<HEADER>", '<HEADER xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="ignored.xsd">'),
  ...["HEADER", "RECORDS", "RECORD", "CALL"].map(name =>
    adx("<CALL>W1AW</CALL>").replace(`<${name}>`, `<${name} xmlns="urn:foreign">`)),
  '<ADX xmlns="urn:adif"><HEADER/><RECORDS><RECORD><CALL xmlns="">W1AW</CALL></RECORD></RECORDS></ADX>',
  adx("<CALL>W1AW</CALL>").replace("<RECORDS>", "<RECORDS>\u00a0"),
  adx("<CALL>W1AW</CALL>").replace("<HEADER>", "<HEADER>\uFEFF"),
])("rejects misplaced, foreign or silently discarded ADX structure before preview: %s", source => {
  expect(() => decode(source)).toThrow("invalid or unsupported XML structure");
});

it.each([
  '<!DOCTYPE ADX [<!ENTITY custom "value">]>' + adx("<COMMENT>&custom;</COMMENT>"),
  '<!DOCTYPE ADX SYSTEM "https://example.invalid/external.dtd">' + adx("<CALL>W1AW</CALL>"),
  '<?xml version="1.0" encoding="ISO-8859-1"?>' + adx("<CALL>W1AW</CALL>"),
  adx("<CALL>W1AW</CALL><call>K1ABC</call>"),
  adx('<APP PROGRAMID="TEST" FIELDNAME="X">a</APP><APP_TEST_X>b</APP_TEST_X>'),
  adx("<COMMENT><CALL>W1AW</CALL></COMMENT>"),
  adx("<COMMENT>&unknown;</COMMENT>"),
  adx('<CALL unexpected="ignored">W1AW</CALL>'),
  adx('<USERDEF FIELDNAME="EOR">bad</USERDEF>'),
  adx('<APP FIELDNAME="X">bad</APP>'),
  adx("<CALL>W1AW</CALL>").replace("</RECORD>", ""),
  adx("<CALL>W1AW</CALL>").replace("<RECORDS>", "<RECORDS>lost text"),
  "<ADX><HEADER/><RECORDS/></ADX>",
  "<ADX><HEADER/><RECORDS><UNEXPECTED/></RECORDS></ADX>",
])("rejects unsafe, lossy or malformed XML before preview: %s", source => {
  expect(() => decode(source)).toThrow();
});

it("rejects UTF-16 and unsupported XML encoding even when its text is ASCII", () => {
  expect(() => decode("<\0A\0D\0X\0>\0")).toThrow("Only UTF-8");
  expect(() => decodeADIF(new Uint8Array([0xff, 0xfe, 60, 0]).buffer)).toThrow("Only UTF-8");
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

const adiRecord = (fields: Record<string, string>) => Object.entries(fields).map(([name, value]) => `<${name}:${new TextEncoder().encode(value).length}>${value}`).join("") + "<EOR>\r\n";

it("preserves valid ADX scalar spellings exactly in both directions without floating-point conversion", () => {
  const fields = { DXCC: "522", MY_DXCC: "0", CQZ: "015", ITUZ: "090", MY_CQ_ZONE: "01", MY_ITU_ZONE: "90",
    FREQ: "14.074000", FREQ_RX: ".1250", TX_PWR: "9007199254740993.1234567890", RX_PWR: "-0.000",
    QSO_DATE: "20240229", QSO_DATE_OFF: "20240301", TIME_ON: "235959", TIME_OFF: "0000", QSLRDATE: "20261014",
    LOTW_QSLSDATE: "20261014", QSL_SENT: "q", QSL_RCVD: "i", LOTW_QSL_RCVD: "y", EQSL_QSL_SENT: "r",
    QSL_SENT_VIA: "b", QSL_RCVD_VIA: "D", SWL: "n", QSO_RANDOM: "Y", FORCE_INIT: "y", SILENT_KEY: "N" };
  const original = adiRecord(fields);
  const writer = new ADIFExportDocument("adx"); writer.append(original, 1);
  expect(decode(writer.finish())).toBe(original);
});

it.each([
  ["AGE", "0"], ["AGE", "-0.000"], ["AGE", ".5"], ["AGE", "00120.000"],
  ["AGE", "119.9999999999999999999999999"], ["A_INDEX", "000."], ["A_INDEX", "0400.000"],
  ["A_INDEX", "399.9999999999999999999999999"],
  ["ANT_AZ", "0"], ["ANT_AZ", "-000.000"], ["ANT_AZ", "00360.000"],
  ["ANT_AZ", "359.9999999999999999999999999"], ["ANT_AZ", ".0000000000000000000000001"],
  ["ANT_EL", "-090.000"], ["ANT_EL", "0090."], ["ANT_EL", "-0.000"], ["ANT_EL", "-.5"],
  ["ANT_EL", "-89.9999999999999999999999999"], ["ANT_EL", "89.9999999999999999999999999"],
])("preserves exact bounded numeric ADX text %s=%s at both boundaries", (name, value) => {
  const original = adiRecord({ [name]: value });
  expect(decode(adx(`<${name}>${value}</${name}>`))).toBe(original);
  const writer = new ADIFExportDocument("adx"); writer.append(original, 1);
  expect(decode(writer.finish())).toBe(original);
});

it.each([
  ["AGE", "120.0000000000000000000000001"], ["AGE", "121"], ["AGE", "-0.0000000000000000000000001"],
  ["AGE", ""], ["AGE", " 120"], ["AGE", "120\n"], ["AGE", "+120"], ["AGE", "1e2"],
  ["A_INDEX", "400.0000000000000000000000001"], ["A_INDEX", "401"], ["A_INDEX", "-1"],
  ["A_INDEX", "NaN"], ["A_INDEX", "."], ["A_INDEX", "1.2.3"], ["A_INDEX", "1,5"],
  ["ANT_AZ", "360.0000000000000000000000001"], ["ANT_AZ", "-0.0000000000000000000000001"],
  ["ANT_AZ", "361"], ["ANT_AZ", ""], ["ANT_AZ", "360\n"], ["ANT_AZ", "+1"],
  ["ANT_AZ", "3.6e2"], ["ANT_AZ", "1,5"], ["ANT_AZ", " 1"],
  ["ANT_EL", "90.0000000000000000000000001"], ["ANT_EL", "-90.0000000000000000000000001"],
  ["ANT_EL", "-91"], ["ANT_EL", "91"], ["ANT_EL", "NaN"], ["ANT_EL", "."], ["ANT_EL", "1.2.3"],
  ["DXCC", "523"], ["DXCC", "1000"], ["DXCC", "0291"], ["DXCC", ""], ["MY_DXCC", "-1"],
  ["CQZ", "0"], ["CQZ", "41"], ["ITUZ", "91"], ["MY_CQ_ZONE", "15.0"], ["MY_ITU_ZONE", " 28"],
  ["FREQ", "1e3"], ["FREQ", "NaN"], ["FREQ_RX", "+14.074"], ["FREQ", "14,074"],
  ["TX_PWR", "-0.0000000000000000000000001"], ["RX_PWR", "-1"], ["TX_PWR", ""],
  ["QSO_DATE", "20260230"], ["QSO_DATE", "19291231"], ["QSLRDATE", "2026-10-14"], ["LOTW_QSLSDATE", ""],
  ["TIME_ON", "2400"], ["TIME_OFF", "1234567"], ["QSL_RCVD", "V"], ["LOTW_QSL_SENT", "yes"],
  ["EQSL_QSL_RCVD", ""], ["QSL_SENT_VIA", "bureau"], ["SWL", "true"], ["QSO_RANDOM", "1"],
])("rejects non-schema ADX scalar %s=%s at both boundaries while ADI stays exact", (name, value) => {
  expect(() => decode(adx(`<${name}>${value}</${name}>`))).toThrow(`Field ${name} has an invalid ADX typed value`);
  const original = adiRecord({ [name]: value });
  const xml = new ADIFExportDocument("adx");
  expect(() => xml.append(original, 1)).toThrow(`Field ${name} has an invalid ADX typed value`);
  expect(() => xml.finish()).toThrow("incomplete");
  const adi = new ADIFExportDocument("adi"); adi.append(original, 1);
  expect(adi.finish()).toBe(original);
  expect(decode(original)).toBe(original);
});

const remainingADXNumbers = ["ALTITUDE", "MY_ALTITUDE", "DISTANCE", "MAX_BURSTS"];
it.each([
  ...remainingADXNumbers.flatMap(name => ["0", "-0.000", "-.000", "001.500", ".0000000000000000000000001", "9007199254740993.1234567890123456789", "0001."].map(value => [name, value])),
  ...["ALTITUDE", "MY_ALTITUDE"].flatMap(name => ["-430.500", "-.1234567890123456789", "-9007199254740993.1234567890123456789"].map(value => [name, value])),
])("preserves unbounded ADX Number/NumberGE0 %s=%s exactly in both directions", (name, value) => {
  const original = adiRecord({ [name]: value });
  expect(decode(adx(`<${name}>${value}</${name}>`))).toBe(original);
  const writer = new ADIFExportDocument("adx"); writer.append(original, 1);
  expect(decode(writer.finish())).toBe(original);
});

it.each([
  ...remainingADXNumbers.flatMap(name => ["", ".", "-.", "+1", "1e2", "NaN", "Infinity", "1,000", "1.2.3", "--1", " 1", "1 ", "1\n", "1\t"].map(value => [name, value])),
  ...["DISTANCE", "MAX_BURSTS"].flatMap(name => ["-1", "-.0000000000000000000000001", "-9007199254740993.123456789"].map(value => [name, value])),
])("rejects invalid ADX Number/NumberGE0 %s=%s and preserves the ADI fallback", (name, value) => {
  expect(() => decode(adx(`<${name}>${value}</${name}>`))).toThrow(`Field ${name} has an invalid ADX typed value`);
  const original = adiRecord({ [name]: value });
  const writer = new ADIFExportDocument("adx");
  expect(() => writer.append(original, 1)).toThrow(`Field ${name} has an invalid ADX typed value`);
  expect(() => writer.finish()).toThrow("incomplete");
  const adi = new ADIFExportDocument("adi"); adi.append(original, 1);
  expect(adi.finish()).toBe(original);
  expect(decode(original)).toBe(original);
});

const nonnegativeADXIntegers = ["K_INDEX", "SFI", "NR_BURSTS", "NR_PINGS", "SRX", "STX"];
const positiveADXIntegers = ["FISTS", "FISTS_CC", "MY_FISTS", "TEN_TEN", "UKSMG", "IOTA_ISLAND_ID", "MY_IOTA_ISLAND_ID"];
it.each([
  ...nonnegativeADXIntegers.flatMap(name => ["0", "-000", "0001"].map(value => [name, value])),
  ...positiveADXIntegers.flatMap(name => ["1", "0001"].map(value => [name, value])),
  ["K_INDEX", "0009"], ["SFI", "00300"], ["IOTA_ISLAND_ID", "099999999"], ["MY_IOTA_ISLAND_ID", "99999999"],
  ...["NR_BURSTS", "NR_PINGS", "SRX", "STX", "FISTS", "FISTS_CC", "MY_FISTS", "TEN_TEN", "UKSMG"]
    .map(name => [name, "900719925474099312345678901234567890"]),
])("preserves exact ADX integer-family text %s=%s in both directions", (name, value) => {
  const original = adiRecord({ [name]: value });
  expect(decode(adx(`<${name}>${value}</${name}>`))).toBe(original);
  const writer = new ADIFExportDocument("adx"); writer.append(original, 1);
  expect(decode(writer.finish())).toBe(original);
});

it.each([
  ...[...nonnegativeADXIntegers, ...positiveADXIntegers].flatMap(name =>
    ["", "-1", "1.0", ".5", "+1", "1e2", " 1", "1 ", "1\n", "NaN", "1,000"].map(value => [name, value])),
  ...positiveADXIntegers.flatMap(name => ["0", "000", "-0", "-0001"].map(value => [name, value])),
  ["K_INDEX", "10"], ["K_INDEX", "00010"], ["SFI", "301"], ["SFI", "9007199254740993"],
  ["IOTA_ISLAND_ID", "100000000"], ["MY_IOTA_ISLAND_ID", "100000000"],
])("rejects invalid ADX integer-family text %s=%s at both boundaries while ADI stays exact", (name, value) => {
  expect(() => decode(adx(`<${name}>${value}</${name}>`))).toThrow(`Field ${name} has an invalid ADX typed value`);
  const original = adiRecord({ [name]: value });
  const writer = new ADIFExportDocument("adx");
  expect(() => writer.append(original, 1)).toThrow(`Field ${name} has an invalid ADX typed value`);
  expect(() => writer.finish()).toThrow("incomplete");
  const adi = new ADIFExportDocument("adi"); adi.append(original, 1);
  expect(adi.finish()).toBe(original);
  expect(decode(original)).toBe(original);
});

it("rejects undefined XSD type indicators without changing supported extension text", () => {
  expect(() => decode(adx('<APP PROGRAMID="TEST" FIELDNAME="X" TYPE="Z">value</APP>'))).toThrow();
  expect(() => decode(adx('<USERDEF FIELDNAME="X">value</USERDEF>', '<USERDEF FIELDID="1" TYPE="Z">X</USERDEF>'))).toThrow();
  expect(decode(adx('<APP PROGRAMID="TEST" FIELDNAME="X" TYPE="G">Žilina 😀</APP>'))).toBe(adiRecord({ APP_TEST_X: "Žilina 😀" }));
});

it("roundtrips exact APP identities, type spelling and USERDEF declarations through explicit versioned metadata", () => {
  const source = adx('<APP PROGRAMID="Mixed_Name" FIELDNAME="Field_Name" TYPE="n">0012.50</APP>' +
    '<APP PROGRAMID="Other" FIELDNAME="Untyped">Žilina 😀</APP><USERDEF FIELDNAME="CUSTOM">B</USERDEF>',
    '<USERDEF FIELDID="17" TYPE="e" ENUM="{A,B}">CUSTOM</USERDEF>');
  const imported = decodeADIFDocument(new TextEncoder().encode(source).buffer);
  expect(imported.text).toContain("<APP_MIXED_NAME_FIELD_NAME:7>0012.50");
  expect(imported.fieldMetadata[0]?.version).toBe(1);
  const writer = new ADIFExportDocument("adx"); writer.append(imported.text, 1, imported.fieldMetadata);
  const exported = writer.finish();
  expect(exported).toContain('<APP PROGRAMID="Mixed_Name" FIELDNAME="Field_Name" TYPE="n">0012.50</APP>');
  expect(exported).toContain('<APP PROGRAMID="Other" FIELDNAME="Untyped">Žilina 😀</APP>');
  expect(exported).toContain('<USERDEF FIELDID="17" TYPE="e" ENUM="{A,B}">CUSTOM</USERDEF>');
  expect(decodeADIFDocument(new TextEncoder().encode(exported).buffer)).toEqual(imported);
  expect(() => new ADIFExportDocument("adi").append(imported.text, 1, imported.fieldMetadata)).toThrow("requires ADX export");
  const corrupt = JSON.parse(JSON.stringify(imported.fieldMetadata));
  corrupt[0].extensions.APP_MIXED_NAME_FIELD_NAME.attributes.TYPE = "";
  expect(() => new ADIFExportDocument("adx").append(imported.text, 1, corrupt)).toThrow("metadata");
});

it.each([
  adx('<USERDEF FIELDNAME="CUSTOM">x</USERDEF>'),
  adx('<USERDEF FIELDNAME="CUSTOM">x</USERDEF>', '<USERDEF FIELDID="1" TYPE="G">CUSTOM</USERDEF><USERDEF FIELDID="1" TYPE="G">OTHER</USERDEF>'),
  adx('<USERDEF FIELDNAME="CUSTOM">x</USERDEF>', '<USERDEF FIELDID="1" TYPE="G">CUSTOM</USERDEF><USERDEF FIELDID="2" TYPE="N">CUSTOM</USERDEF>'),
  adx('<APP PROGRAMID="A_B" FIELDNAME="C">x</APP><APP PROGRAMID="A" FIELDNAME="B_C">y</APP>'),
  adx('<APP PROGRAMID="TEST" FIELDNAME="X" TYPE="N">NaN</APP>'),
  adx('<APP PROGRAMID="TEST" FIELDNAME="X" TYPE="S">Žilina</APP>'),
  adx('<USERDEF FIELDNAME="CUSTOM">C</USERDEF>', '<USERDEF FIELDID="1" TYPE="E" ENUM="{A,B}">CUSTOM</USERDEF>'),
  adx('<USERDEF FIELDNAME="CUSTOM">2</USERDEF>', '<USERDEF FIELDID="1" TYPE="N" RANGE="{1:1}">CUSTOM</USERDEF>'),
  adx('<USERDEF FIELDNAME="CUSTOM">A</USERDEF>', '<USERDEF FIELDID="1" TYPE="E" ENUM="{A,B}&#10;">CUSTOM</USERDEF>'),
  adx('<USERDEF FIELDNAME="CALL">x</USERDEF>', '<USERDEF FIELDID="1" TYPE="G">CALL</USERDEF>'),
])("rejects lossy, conflicting or unsupported extension metadata: %s", source => {
  expect(() => decodeADIFDocument(new TextEncoder().encode(source).buffer)).toThrow();
});

it("rejects conflicting declarations across frozen export frames and unknown metadata versions", () => {
  const first = decodeADIFDocument(new TextEncoder().encode(adx('<USERDEF FIELDNAME="CUSTOM">A</USERDEF>', '<USERDEF FIELDID="1" TYPE="G">CUSTOM</USERDEF>')).buffer);
  const other = decodeADIFDocument(new TextEncoder().encode(adx('<USERDEF FIELDNAME="CUSTOM">1</USERDEF>', '<USERDEF FIELDID="1" TYPE="N">CUSTOM</USERDEF>')).buffer);
  const writer = new ADIFExportDocument("adx"); writer.append(first.text, 1, first.fieldMetadata);
  expect(() => writer.append(other.text, 1, other.fieldMetadata)).toThrow("metadata");
  expect(() => writer.finish()).toThrow("incomplete");
  const unsupported = JSON.parse(JSON.stringify(first.fieldMetadata)); unsupported[0].version = 2;
  expect(() => new ADIFExportDocument("adx").append(first.text, 1, unsupported)).toThrow("metadata");
  expect(() => new ADIFExportDocument("adx").append(first.text, 1, [])).toThrow("metadata");
});

it("splits metadata-heavy import frames without separating metadata from its exact record", () => {
  const record = '<RECORD><CALL>W1AW</CALL><APP PROGRAMID="Long_Program_Name" FIELDNAME="Long_Field_Name" TYPE="G">Žilina 😀</APP></RECORD>';
  const document = decodeADIFDocument(new TextEncoder().encode(`<ADX><HEADER/><RECORDS>${record.repeat(101)}</RECORDS></ADX>`).buffer);
  const frames = adifImportBatches(document);
  expect(frames.length).toBeGreaterThan(2);
  expect(frames.map(frame => frame.text).join("")).toBe(document.text);
  expect(frames.flatMap(frame => frame.fieldMetadata ?? [])).toEqual(document.fieldMetadata);
  for (const frame of frames) expect(new TextEncoder().encode(JSON.stringify(frame.fieldMetadata)).length).toBeLessThanOrEqual(16_384);
});

it("freezes declaration metadata when an export frame is admitted", () => {
  const document = decodeADIFDocument(new TextEncoder().encode(adx('<USERDEF FIELDNAME="CUSTOM">A</USERDEF>', '<USERDEF FIELDID="17" TYPE="G">CUSTOM</USERDEF>')).buffer);
  const writer = new ADIFExportDocument("adx"); writer.append(document.text, 1, document.fieldMetadata);
  document.fieldMetadata[0]!.extensions.CUSTOM.declaration!.TYPE = "N";
  expect(writer.finish()).toContain('<USERDEF FIELDID="17" TYPE="G">CUSTOM</USERDEF>');
});

it.each([
  ["n", "{001.:0003.00}", "0002.500"], ["N", "{-.5:.5}", "-0.000"], ["N", "{-10:-2}", "-2"],
  ["N", "{9007199254740992:9007199254740993}", "9007199254740993"],
  ["N", "{.00000000000000000001:.00000000000000000002}", ".00000000000000000002"],
  ["I", "{-.5:1.5}", "0001"], ["I", "{-999999999999999999999:999999999999999999999}", "-999999999999999999999"],
])("preserves exact ranged USERDEF metadata and values: %s %s %s", (type, range, value) => {
  const source = adx(`<USERDEF FIELDNAME="CUSTOM">${value}</USERDEF>`, `<USERDEF FIELDID="17" TYPE="${type}" RANGE="${range}">CUSTOM</USERDEF>`);
  const document = decodeADIFDocument(new TextEncoder().encode(source).buffer);
  const writer = new ADIFExportDocument("adx"); writer.append(document.text, 1, document.fieldMetadata);
  const xml = writer.finish();
  expect(xml).toContain(`TYPE="${type}" RANGE="${range}"`);
  expect(decodeADIFDocument(new TextEncoder().encode(xml).buffer)).toEqual(document);
});

it.each([
  ["N", "{1:3}", "0.999999999999999999999"], ["N", "{1:3}", "3.000000000000000000001"],
  ["N", "{9007199254740992:9007199254740993}", "9007199254740993.0000000001"],
  ["N", "{-10:-2}", "-10.00000000000000001"], ["N", "{-0.:0.000}", "0"],
  ["N", "{3:1}", "2"], ["N", "{1:1}", "1"], ["N", "{+1:3}", "2"], ["N", "{1e0:3}", "2"],
  ["N", "{1,0:3}", "2"], ["N", "{1:3} ", "2"], ["N", "{1:3}\n", "2"], ["N", "{.:3}", "2"],
  ["N", "{1::3}", "2"], ["N", "{1:}", "2"], ["S", "{1:3}", "2"], ["E", "{1:3}", "2"], ["I", "{1:3}", "2.0"],
])("rejects malformed, inapplicable or out-of-range USERDEF at both boundaries: %s %s %s", (type, range, value) => {
  const metadata = { version: 1 as const, extensions: { CUSTOM: { kind: "USERDEF" as const, attributes: { FIELDNAME: "CUSTOM" }, declaration: { FIELDID: "17", TYPE: type, RANGE: range } } } };
  expect(() => new ADIFExportDocument("adx").append(adiRecord({ CUSTOM: value }), 1, [metadata])).toThrow();
  const escapedRange = range.replace(/\n/g, "&#10;");
  expect(() => decodeADIFDocument(new TextEncoder().encode(adx(`<USERDEF FIELDNAME="CUSTOM">${value}</USERDEF>`, `<USERDEF FIELDID="17" TYPE="${type}" RANGE="${escapedRange}">CUSTOM</USERDEF>`)).buffer)).toThrow();
});

it("rejects ENUM+RANGE and conflicting RANGE declarations even if equivalent numerically", () => {
  expect(() => decodeADIFDocument(new TextEncoder().encode(adx('<USERDEF FIELDNAME="CUSTOM">2</USERDEF>', '<USERDEF FIELDID="1" TYPE="N" ENUM="{1,2,3}" RANGE="{1:3}">CUSTOM</USERDEF>')).buffer)).toThrow();
  const first = decodeADIFDocument(new TextEncoder().encode(adx('<USERDEF FIELDNAME="CUSTOM">2</USERDEF>', '<USERDEF FIELDID="1" TYPE="N" RANGE="{1:3}">CUSTOM</USERDEF>')).buffer);
  const other = decodeADIFDocument(new TextEncoder().encode(adx('<USERDEF FIELDNAME="CUSTOM">2</USERDEF>', '<USERDEF FIELDID="1" TYPE="N" RANGE="{01:3.0}">CUSTOM</USERDEF>')).buffer);
  const writer = new ADIFExportDocument("adx"); writer.append(first.text, 1, first.fieldMetadata);
  expect(() => writer.append(other.text, 1, other.fieldMetadata)).toThrow();
});

const adxStatusValues: Record<string, string[]> = {
  CLUBLOG_QSO_UPLOAD_STATUS: ["Y", "N", "M", "y", "n", "m"],
  HAMLOGEU_QSO_UPLOAD_STATUS: ["Y", "N", "M", "y", "n", "m"],
  HAMQTH_QSO_UPLOAD_STATUS: ["Y", "N", "M", "y", "n", "m"],
  HRDLOG_QSO_UPLOAD_STATUS: ["Y", "N", "M", "y", "n", "m"],
  QRZCOM_QSO_UPLOAD_STATUS: ["Y", "N", "M", "y", "n", "m"],
  QRZCOM_QSO_DOWNLOAD_STATUS: ["Y", "N", "I", "y", "n", "i"],
  EQSL_AG: ["Y", "N", "U", "y", "n", "u"],
  QSO_COMPLETE: ["Y", "N", "NIL", "?", "y", "n", "nil", "NiL"],
};
it.each(Object.entries(adxStatusValues).flatMap(([name, values]) => values.map(value => [name, value])))
  ("preserves exact ADX exchange/completion enum %s=%s at both boundaries", (name, value) => {
    const original = adiRecord({ [name]: value });
    expect(decode(adx(`<${name}>${value}</${name}>`))).toBe(original);
    const writer = new ADIFExportDocument("adx"); writer.append(original, 1);
    expect(decode(writer.finish())).toBe(original);
  });

it.each(Object.keys(adxStatusValues).flatMap(name =>
  ["", "YES", "true", "1", "YY", " Y", "Y ", "Y\n", "Y\r", "Y\t", "R", "Q", "M", "I", "U", "NIL", "?"].filter(value =>
    !adxStatusValues[name].includes(value)).map(value => [name, value])))
  ("rejects invalid or wrong-family ADX status %s=%s while preserving ADI", (name, value) => {
    expect(() => decode(adx(`<${name}>${value}</${name}>`))).toThrow(`Field ${name} has an invalid ADX typed value`);
    const original = adiRecord({ [name]: value });
    const writer = new ADIFExportDocument("adx");
    expect(() => writer.append(original, 1)).toThrow(`Field ${name} has an invalid ADX typed value`);
    expect(() => writer.finish()).toThrow("incomplete");
    const adi = new ADIFExportDocument("adi"); adi.append(original, 1);
    expect(adi.finish()).toBe(original);
    expect(decode(original)).toBe(original);
  });

const adxStaticEnumerationValues: Record<string, string[]> = {
  BAND: ["2190m", "1.25M", "70cm", "2.5mm", "submm"],
  BAND_RX: ["160M", "23cm", "1MM"],
  MODE: ["cw", "DIGITALVOICE", "FSK441", "jt65", "SSB", "WSPR"],
  ARRL_SECT: ["al", "EMA", "NLI", "org", "WCF"],
  MY_ARRL_SECT: ["AK", "GTA", "NTX", "ONE", "wwa"],
  MORSE_KEY_TYPE: ["sk", "SS", "bug", "FAB", "CPU"],
  MY_MORSE_KEY_TYPE: ["sp", "DP"],
  PROP_MODE: ["as", "AUE", "internet", "RPT", "gwave", "LOS"],
  REGION: ["none", "IV", "ai", "SY", "et"],
};
it.each(Object.entries(adxStaticEnumerationValues).flatMap(([name, values]) => values.map(value => [name, value])))
  ("preserves exact ADX static enumeration %s=%s at both boundaries", (name, value) => {
    const original = adiRecord({ [name]: value });
    expect(decode(adx(`<${name}>${value}</${name}>`))).toBe(original);
    const writer = new ADIFExportDocument("adx"); writer.append(original, 1);
    expect(decode(writer.finish())).toBe(original);
  });

it.each([
  ["BAND", "11m"], ["BAND_RX", "20"], ["MODE", "USB"], ["MODE", "FT4"],
  ["ARRL_SECT", "ZZ"], ["MY_ARRL_SECT", "DX"], ["MORSE_KEY_TYPE", "PADDLE"],
  ["MY_MORSE_KEY_TYPE", ""], ["PROP_MODE", "GROUNDWAVE"], ["REGION", "EU"],
  ...Object.keys(adxStaticEnumerationValues).map(name => [name, `${adxStaticEnumerationValues[name][0]}\n`]),
])("rejects invalid ADX static enumeration %s=%s while preserving ADI", (name, value) => {
  expect(() => decode(adx(`<${name}>${value}</${name}>`))).toThrow(`Field ${name} has an invalid ADX typed value`);
  const original = adiRecord({ [name]: value });
  const writer = new ADIFExportDocument("adx");
  expect(() => writer.append(original, 1)).toThrow(`Field ${name} has an invalid ADX typed value`);
  expect(() => writer.finish()).toThrow("incomplete");
  const adi = new ADIFExportDocument("adi"); adi.append(original, 1);
  expect(adi.finish()).toBe(original);
  expect(decode(original)).toBe(original);
});

it("recognizes all ADIF 3.1.7 record elements, including GUEST_OP and VE_PROV", () => {
  const original = adiRecord({ GUEST_OP: "K1ABC", VE_PROV: "NS" });
  expect(decode(adx("<GUEST_OP>K1ABC</GUEST_OP><VE_PROV>NS</VE_PROV>"))).toBe(original);
  const writer = new ADIFExportDocument("adx"); writer.append(original, 1);
  const xml = writer.finish();
  expect(xml).toContain("<GUEST_OP>K1ABC</GUEST_OP>");
  expect(xml).toContain("<VE_PROV>NS</VE_PROV>");
  expect(xml).not.toContain("<USERDEF");
});

it.each([
  ["STATE", "NS"], ["MY_STATE", "New South Wales"], ["CNTY", "VA,Richmond"], ["MY_CNTY", "Zilina"],
  ["CNTY_ALT", "NZ_REGIONS:Hawkes Bay/Hastings"], ["MY_CNTY_ALT", "nz_regions:West-Coast/Buller"],
  ["SUBMODE", "FT8"], ["SUBMODE", "FM-N"], ["USACA_COUNTIES", "VA,Richmond"],
  ["USACA_COUNTIES", "TX,De Witt:LA,St. John the Baptist"], ["MY_USACA_COUNTIES", "AK,Prince of Wales-Hyder"],
])("preserves ADX subdivision/list schema text %s=%s at both boundaries", (name, value) => {
  const original = adiRecord({ [name]: value });
  expect(decode(adx(`<${name}>${value}</${name}>`))).toBe(original);
  const writer = new ADIFExportDocument("adx"); writer.append(original, 1);
  expect(decode(writer.finish())).toBe(original);
});

it.each([
  ["STATE", ""], ["MY_STATE", "Žilina"], ["CNTY", "line\nbreak"], ["MY_CNTY", "\t"],
  ["CNTY_ALT", "NZ_REGIONS:West  Coast/Buller"], ["CNTY_ALT", "NZ_REGIONS:West Coast/Bul"],
  ["MY_CNTY_ALT", "NZ_REGIONS:West Coast/Buller/Extra"], ["SUBMODE", "FT"], ["SUBMODE", " FT8"],
  ["SUBMODE", "FT8 "], ["SUBMODE", "F\n8"], ["USACA_COUNTIES", ""], ["USACA_COUNTIES", "DC,Washington"],
  ["USACA_COUNTIES", "VA,Richmond:"], ["USACA_COUNTIES", "VA Richmond"], ["USACA_COUNTIES", "VA,R"],
  ["MY_USACA_COUNTIES", "VA,Richmond,City"], ["MY_USACA_COUNTIES", "VA,Žilina"],
])("rejects invalid ADX subdivision/list schema text %s=%s while preserving ADI", (name, value) => {
  expect(() => decode(adx(`<${name}>${value}</${name}>`))).toThrow(`Field ${name} has an invalid ADX typed value`);
  const original = adiRecord({ [name]: value });
  const writer = new ADIFExportDocument("adx");
  expect(() => writer.append(original, 1)).toThrow(`Field ${name} has an invalid ADX typed value`);
  const adi = new ADIFExportDocument("adi"); adi.append(original, 1);
  expect(adi.finish()).toBe(original);
  expect(decode(original)).toBe(original);
});

const adxStringFamilies: Record<string, string[]> = {
  ascii: `CALL CHECK CLASS COMMENT CONTACTED_OP CONTEST_ID COUNTRY EMAIL EQ_CALL GUEST_OP MORSE_KEY_INFO MS_SHOWER MY_ANTENNA MY_CITY
    MY_COUNTRY MY_MORSE_KEY_INFO MY_NAME MY_POSTAL_CODE MY_RIG MY_SIG MY_SIG_INFO MY_STREET NAME OPERATOR OWNER_CALLSIGN
    PFX PRECEDENCE PUBLIC_KEY QSL_VIA QTH RST_RCVD RST_SENT SAT_MODE SAT_NAME SIG SIG_INFO SKCC SRX_STRING STATION_CALLSIGN
    STX_STRING VE_PROV WEB`.split(/\s+/),
  multiline: "ADDRESS NOTES QSLMSG QSLMSG_RCVD RIG".split(" "),
  international: `COMMENT_INTL COUNTRY_INTL MY_ANTENNA_INTL MY_CITY_INTL MY_COUNTRY_INTL MY_NAME_INTL MY_POSTAL_CODE_INTL
    MY_RIG_INTL MY_SIG_INTL MY_SIG_INFO_INTL MY_STREET_INTL NAME_INTL QTH_INTL SIG_INTL SIG_INFO_INTL`.split(/\s+/),
  internationalMultiline: "ADDRESS_INTL NOTES_INTL QSLMSG_INTL RIG_INTL".split(" "),
};
it.each([
  ...adxStringFamilies.ascii.map(name => [name, 'ASCII <EOR> & "quoted"']),
  ...adxStringFamilies.multiline.map(name => [name, "line 1\r\nline 2"]),
  ...adxStringFamilies.international.map(name => [name, "Žilina 😀"]),
  ...adxStringFamilies.internationalMultiline.map(name => [name, "Žilina 😀\r\n未知"]),
])("preserves ADX string-family text %s at both boundaries", (name, value) => {
  const original = adiRecord({ [name]: value });
  expect(decode(adx(`<${name}>${value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r/g, "&#13;")}</${name}>`))).toBe(original);
  const writer = new ADIFExportDocument("adx"); writer.append(original, 1);
  expect(decode(writer.finish())).toBe(original);
});

it.each([
  ...adxStringFamilies.ascii.map(name => [name, "Žilina"]),
  ...adxStringFamilies.multiline.map(name => [name, "Žilina"]),
  ...adxStringFamilies.international.map(name => [name, "line 1\nline 2"]),
])("rejects invalid ADX string-family text %s while preserving ADI", (name, value) => {
  expect(() => decode(adx(`<${name}>${value}</${name}>`))).toThrow(`Field ${name} has an invalid ADX typed value`);
  const original = adiRecord({ [name]: value });
  const writer = new ADIFExportDocument("adx");
  expect(() => writer.append(original, 1)).toThrow(`Field ${name} has an invalid ADX typed value`);
  const adi = new ADIFExportDocument("adi"); adi.append(original, 1);
  expect(adi.finish()).toBe(original);
  expect(decode(original)).toBe(original);
});

const adxCreditNames = `CQDX CQDX_BAND CQDX_MODE CQDX_MOBILE CQDX_QRP CQDX_SATELLITE CQDXFIELD CQDXFIELD_BAND
  CQDXFIELD_MODE CQDXFIELD_MOBILE CQDXFIELD_QRP CQDXFIELD_SATELLITE CQWAZ_MIXED CQWAZ_BAND CQWAZ_MODE CQWAZ_SATELLITE
  CQWAZ_EME CQWAZ_MOBILE CQWAZ_QRP CQWPX CQWPX_BAND CQWPX_MODE DXCC DXCC_BAND DXCC_MODE DXCC_SATELLITE EAUSTRALIA
  ECANADA ECOUNTY_STATE EDX EDX100 EDX100_BAND EDX100_MODE EECHOLINK50 EGRID_BAND EGRID_SATELLITE EPFX300 EPFX300_MODE
  EWAS EWAS_BAND EWAS_MODE EWAS_SATELLITE EZ40 EZ40_MODE FFMA IOTA IOTA_BASIC IOTA_CONT IOTA_GROUP RDA USACA VUCC_BAND
  VUCC_SATELLITE WAB WAC WAC_BAND WAE WAE_BAND WAE_MODE WAIP WAIP_BAND WAIP_MODE WAS WAS_BAND WAS_EME WAS_MODE
  WAS_NOVICE WAS_QRP WAS_SATELLITE WITUZ WITUZ_BAND`.split(/\s+/);
it.each(["CREDIT_SUBMITTED", "CREDIT_GRANTED"])("preserves every ADX 3.1.7 credit name and confirmation source in %s", name => {
  const value = adxCreditNames.map((credit, index) => `${index % 2 ? credit.toLowerCase() : credit}:${index % 3 ? "card&eqsl" : "LOTW"}`).join(",");
  const original = adiRecord({ [name]: value });
  expect(decode(adx(`<${name}>${value.replace(/&/g, "&amp;")}</${name}>`))).toBe(original);
  const writer = new ADIFExportDocument("adx"); writer.append(original, 1);
  expect(decode(writer.finish())).toBe(original);
});

it.each(["AWARD_SUBMITTED", "AWARD_GRANTED"])("preserves ADX 3.1.7 sponsored-award lists in %s", name => {
  const value = "adif_program-award_basic,ARRL_DXCC_MIXED_BAND,CQ_WPX_5_BAND,WABAG_book_class-A";
  const original = adiRecord({ [name]: value });
  expect(decode(adx(`<${name}>${value}</${name}>`))).toBe(original);
  const writer = new ADIFExportDocument("adx"); writer.append(original, 1);
  expect(decode(writer.finish())).toBe(original);
});

it.each([
  ["CREDIT_SUBMITTED", ""], ["CREDIT_SUBMITTED", "CQWAZ"], ["CREDIT_GRANTED", "CQDX_FIELD"],
  ["CREDIT_GRANTED", "DXCC:"], ["CREDIT_GRANTED", "DXCC:CARD&"], ["CREDIT_GRANTED", "DXCC:CARD EQSL"],
  ["CREDIT_GRANTED", "DXCC:CARD:LOTW"], ["CREDIT_GRANTED", "DXCC,CQWPX,"], ["CREDIT_GRANTED", " DXCC"],
  ["AWARD_SUBMITTED", ""], ["AWARD_SUBMITTED", "OTHER_PROGRAM_AWARD"], ["AWARD_GRANTED", "ARRL__AWARD"],
  ["AWARD_GRANTED", "ARRL_PROGRAM_"], ["AWARD_GRANTED", "ARRL_PROGRAM AWARD"], ["AWARD_GRANTED", "ARRL_PROGRAM,AWARD"],
  ["AWARD_GRANTED", "ARRL_PROGRAM_AWARD,"], ["AWARD_GRANTED", " ARRL_PROGRAM_AWARD"],
])("rejects invalid ADX award/list schema text %s=%s while preserving ADI", (name, value) => {
  expect(() => decode(adx(`<${name}>${value.replace(/&/g, "&amp;")}</${name}>`))).toThrow(`Field ${name} has an invalid ADX typed value`);
  const original = adiRecord({ [name]: value });
  const writer = new ADIFExportDocument("adx");
  expect(() => writer.append(original, 1)).toThrow(`Field ${name} has an invalid ADX typed value`);
  const adi = new ADIFExportDocument("adi"); adi.append(original, 1);
  expect(adi.finish()).toBe(original);
  expect(decode(original)).toBe(original);
});

const adxLocations = ["LAT", "LON", "MY_LAT", "MY_LON"];
const adxVUCCFields = ["VUCC_GRIDS", "MY_VUCC_GRIDS"];
it.each([
  ...adxLocations.flatMap(name => ["N000 00.000", "s090 59.999", "e179 00.001", "W180 59.999"].map(value => [name, value])),
  ...adxVUCCFields.flatMap(name => ["JN99,jn98", "aa00,RR99,jn99,JN98", "Jn99aA,jN98xX", "AA00aa,rr99XX,JN99ab,jn98CD", "JN99,JN99"].map(value => [name, value])),
])("preserves exact geographic ADX schema text %s=%s at both boundaries", (name, value) => {
  const original = adiRecord({ [name]: value });
  expect(decode(adx(`<${name}>${value}</${name}>`))).toBe(original);
  const writer = new ADIFExportDocument("adx"); writer.append(original, 1);
  expect(decode(writer.finish())).toBe(original);
});

it.each([
  ...adxLocations.flatMap(name => ["", "N181 00.000", "N090 60.000", "N90 00.000", "N090 0.000", "N090 00.00", "N090 00.0000", "Q090 00.000", "90.000", " N090 00.000", "N090 00.000 ", "N090 00.000\n", "N090\t00.000"].map(value => [name, value])),
  ...adxVUCCFields.flatMap(name => ["", "JN99", "JN99,JN98,JN97", "JN99,JN98,JN97,JN96,JN95", "JN99,JN98aa", "JN99aa,JN98", "JN99aa12,JN98aa12", "SS99,JN98", "JN99yy,JN98aa", "JN99, JN98", "JN99;JN98", "JN99,JN98,", " JN99,JN98", "JN99,JN98\n"].map(value => [name, value])),
])("rejects invalid geographic ADX schema text %s=%s and preserves the ADI fallback", (name, value) => {
  expect(() => decode(adx(`<${name}>${value}</${name}>`))).toThrow(`Field ${name} has an invalid ADX typed value`);
  const original = adiRecord({ [name]: value });
  const writer = new ADIFExportDocument("adx");
  expect(() => writer.append(original, 1)).toThrow(`Field ${name} has an invalid ADX typed value`);
  expect(() => writer.finish()).toThrow("incomplete");
  const adi = new ADIFExportDocument("adi"); adi.append(original, 1);
  expect(adi.finish()).toBe(original);
  expect(decode(original)).toBe(original);
});

it("preserves accepted grid, reference and small enum values exactly across ADX boundaries", () => {
  const fields = { GRIDSQUARE: "jn99aa12", MY_GRIDSQUARE: "JN", GRIDSQUARE_EXT: "xx99", MY_GRIDSQUARE_EXT: "aa",
    IOTA: "eu-001", MY_IOTA: "NA-999", SOTA_REF: "om/za-001", MY_SOTA_REF: "EA8/GC-999",
    POTA_REF: "sk-0001,US-12345@US-NY", MY_POTA_REF: "DE-00001@DE-BY",
    WWFF_REF: "omff-0001", MY_WWFF_REF: "VKFF-0000", DARC_DOK: "a01", MY_DARC_DOK: "01",
    CONT: "eu", ANT_PATH: "s", COMMENT_INTL: "Žilina 😀" };
  const original = adiRecord(fields);
  const writer = new ADIFExportDocument("adx"); writer.append(original, 1);
  expect(decode(writer.finish())).toBe(original);
});

it.each([
  ["GRIDSQUARE", "SS99"], ["GRIDSQUARE", "JN99yy"], ["GRIDSQUARE", "JN9"], ["GRIDSQUARE", "JN99aa123"],
  ["MY_GRIDSQUARE", ""], ["GRIDSQUARE_EXT", "yz"], ["MY_GRIDSQUARE_EXT", "aa9"],
  ["IOTA", "EU-000"], ["IOTA", "ZZ-001"], ["MY_IOTA", "EU-0001"],
  ["SOTA_REF", "OM/ZA-000"], ["SOTA_REF", "OM/Z-001"], ["MY_SOTA_REF", "123456789/ZA-001"],
  ["POTA_REF", "SK-001"], ["POTA_REF", "SK-000001"], ["POTA_REF", "SK-0001, US-0001"],
  ["POTA_REF", "SK-0001@USA-NY"], ["MY_POTA_REF", "SK-0001,"],
  ["WWFF_REF", "OM-0001"], ["MY_WWFF_REF", "OMFF-001"], ["DARC_DOK", "A-01"], ["MY_DARC_DOK", "Ž01"],
  ["CONT", "Europe"], ["CONT", ""], ["ANT_PATH", "short"],
  ["GRIDSQUARE", "JN99\n"], ["IOTA", "EU-001\n"], ["DARC_DOK", "A01\n"], ["CONT", "EU\n"],
  ["CQZ", "15\n"], ["TX_PWR", "100\n"], ["SWL", "Y\n"],
])("rejects unsupported ADX pattern %s=%s while preserving the ADI fallback", (name, value) => {
  expect(() => decode(adx(`<${name}>${value}</${name}>`))).toThrow(`Field ${name} has an invalid ADX typed value`);
  const original = adiRecord({ [name]: value });
  const xml = new ADIFExportDocument("adx");
  expect(() => xml.append(original, 1)).toThrow(`Field ${name} has an invalid ADX typed value`);
  const adi = new ADIFExportDocument("adi"); adi.append(original, 1);
  expect(adi.finish()).toBe(original);
  expect(decode(original)).toBe(original);
});

it("exports ADX from multiple frozen frames with extensions, Unicode, XML escapes and exact CR preservation", () => {
  const writer = new ADIFExportDocument("adx");
  const first = adiRecord({ CALL: "W1AW", COMMENT_INTL: 'Žilina <EOR> & "quoted" 😀', NOTES: "line1\r\nline2\rline3", APP_TEST_OPAQUE: "é", CUSTOM: "", CLUBLOG_QSO_UPLOAD_STATUS: "Y" });
  const second = adiRecord({ CALL: "K1ABC", CUSTOM: "new", ANOTHER: "x" });
  writer.append("<ADIF_VER:5>3.1.7<EOH>\r\n" + first, 1);
  writer.append(second, 1);
  const xml = writer.finish();
  const document = new DOMParser().parseFromString(xml, "application/xml");
  expect(document.querySelector("parsererror")).toBeNull();
  expect(xml).toContain('&lt;EOR&gt; &amp; &quot;quoted&quot;');
  expect(xml).toContain("line1&#13;\nline2&#13;line3");
  expect(xml).toContain('<APP PROGRAMID="TEST" FIELDNAME="OPAQUE" TYPE="G">é</APP>');
  expect(xml).toContain('<USERDEF FIELDID="1" TYPE="G">CUSTOM</USERDEF>');
  expect(xml).toContain('<USERDEF FIELDNAME="CUSTOM"></USERDEF>');
  expect(xml).toContain("<CLUBLOG_QSO_UPLOAD_STATUS>Y</CLUBLOG_QSO_UPLOAD_STATUS>");
  expect(document.querySelectorAll("HEADER USERDEF")).toHaveLength(2);
  expect(decode(xml)).toBe(first + second);
});

it("keeps ADI output as the exact original frozen frames", () => {
  const writer = new ADIFExportDocument("adi");
  const first = "<ADIF_VER:5>3.1.7<EOH>\r\n" + adiRecord({ CALL: "W1AW" });
  const second = adiRecord({ CALL: "K1ABC" });
  writer.append(first, 1); writer.append(second, 1);
  expect(writer.finish()).toBe(first + second);
});

it.each([
  "<CALL:4>W1AW<CALL:4>K1AB<EOR>", "<CALL:10>short<EOR>", "<CALL:4>W1AW", "<EOR>",
  "<CALL:2>é<CALL:1>x<EOR>", "<CALL:4:S>W1AW<EOR>", "<CALL:4>W1AW<EOR>trailing",
  adiRecord({ APP_BROKEN: "value" }), adiRecord({ HEADER: "value" }), adiRecord({ PROGRAMID: "value" }),
  adiRecord({ NOTES: "bad\0value" }), adiRecord({ NOTES: "bad\u0001value" }), adiRecord({ NOTES: "\ufffe" }),
  "<NOTES:3>\ud800<EOR>", "<PROGRAMID:4>test<EOH><CALL:4>W1AW<EOR>",
])("fails closed on frozen fields that cannot be converted losslessly: %s", source => {
  const writer = new ADIFExportDocument("adx");
  expect(() => writer.append(source, 1)).toThrow();
  expect(() => writer.finish()).toThrow("incomplete");
});

it("rejects count mismatches, input/output size overruns and oversized custom dictionaries", () => {
  const record = adiRecord({ CALL: "W1AW" });
  expect(() => new ADIFExportDocument("adx").append(record, 2)).toThrow("count");
  expect(() => new ADIFExportDocument("adi").append(record, NaN)).toThrow("count");
  expect(() => new ADIFExportDocument("adi", 10).append(record, 1)).toThrow("file limit");
  const expanded = new ADIFExportDocument("adx", 60);
  expect(() => expanded.append(adiRecord({ NOTES: "&".repeat(30) }), 1)).toThrow("file limit");
  const headerBound = new ADIFExportDocument("adx", 100);
  headerBound.append(record, 1);
  expect(() => headerBound.finish()).toThrow("file limit");
  const dictionary = new ADIFExportDocument("adx");
  for (let index = 0; index < 128; index++) dictionary.append(adiRecord({ [`CUSTOM_${index}`]: "value" }), 1);
  expect(() => dictionary.append(adiRecord({ CUSTOM_MORE: "value" }), 1)).toThrow("custom field");
});
