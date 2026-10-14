// @vitest-environment jsdom
import { expect, it } from "vitest";
import { adifBatches, decodeADIF, ADIFExportDocument } from "./adifTransfer";

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
  const canonical = decodeADIF(legacyBytes(`<NOTES:32>${controls}<EOR>\r\n`), "iso-8859-1");
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

it("converts UTF-8 ADX text, empty fields and extensions into exact byte-counted ADI", () => {
  const converted = decode("\uFEFF<?xml version='1.0' encoding='UTF-8'?>" + adx(
    "<CALL>W1AW</CALL><COMMENT>Žilina &amp; &lt;EOR&gt; 😀</COMMENT><NOTES/>" +
    '<APP PROGRAMID="TEST" FIELDNAME="OPAQUE" TYPE="S">value</APP><USERDEF FIELDNAME="CUSTOM">é</USERDEF>',
    '<USERDEF FIELDID="1" TYPE="S">CUSTOM</USERDEF>'));
  const comment = "Žilina & <EOR> 😀";
  expect(converted).toBe(`<CALL:4>W1AW<COMMENT:${new TextEncoder().encode(comment).length}>${comment}<NOTES:0><APP_TEST_OPAQUE:5>value<CUSTOM:2>é<EOR>\r\n`);
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
  expect(decode('<a:ADX xmlns:a="urn:adif"><a:HEADER/><!-- metadata --><a:RECORDS><?export value?><a:RECORD><a:COMMENT><![CDATA[<EOR> & é]]></a:COMMENT></a:RECORD></a:RECORDS></a:ADX>'))
    .toBe("<COMMENT:10><EOR> & é<EOR>\r\n");
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

it("rejects undefined XSD type indicators without changing supported extension text", () => {
  expect(() => decode(adx('<APP PROGRAMID="TEST" FIELDNAME="X" TYPE="Z">value</APP>'))).toThrow();
  expect(() => decode(adx('<USERDEF FIELDNAME="X">value</USERDEF>', '<USERDEF FIELDID="1" TYPE="Z">X</USERDEF>'))).toThrow();
  expect(decode(adx('<APP PROGRAMID="TEST" FIELDNAME="X" TYPE="G">Žilina 😀</APP>'))).toBe(adiRecord({ APP_TEST_X: "Žilina 😀" }));
});

it("exports ADX from multiple frozen frames with extensions, Unicode, XML escapes and exact CR preservation", () => {
  const writer = new ADIFExportDocument("adx");
  const first = adiRecord({ CALL: "W1AW", COMMENT: 'Žilina <EOR> & "quoted" 😀', NOTES: "line1\r\nline2\rline3", APP_TEST_OPAQUE: "é", CUSTOM: "", CLUBLOG_QSO_UPLOAD_STATUS: "Y" });
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
