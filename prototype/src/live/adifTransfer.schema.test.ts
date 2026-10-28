// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { ADIFExportDocument, decodeADIFDocument } from "./adifTransfer";

it("exports deprecated ADI fields as declared USERDEFs within the independent 3.1.7 RECORD vocabulary", () => {
  const schemaBytes = gunzipSync(readFileSync("tests/fixtures/adx317.xsd.gz"));
  expect(createHash("sha256").update(schemaBytes).digest("hex")).toBe("ce7a86832f7be4a232d2c1ae7432925feb2be8506cba24345b7e3ad994a87331");
  const schema = new DOMParser().parseFromString(schemaBytes.toString("utf8"), "application/xml");
  const elements = [...schema.getElementsByTagNameNS("http://www.w3.org/2001/XMLSchema", "element")];
  const record = elements.find(element => element.getAttribute("name") === "RECORD")!;
  const names = new Set([...record.getElementsByTagNameNS("http://www.w3.org/2001/XMLSchema", "element")].map(element => element.getAttribute("name")));
  expect(names.size).toBe(181); // 179 standard fields plus APP and USERDEF.
  expect(names.has("GUEST_OP")).toBe(false); expect(names.has("VE_PROV")).toBe(false);
  const adi = "<CALL:5>K1ABC<NAME:4>Anne<GUEST_OP:5>K2ABC<VE_PROV:2>ON<EOR>\r\n";
  const writer = new ADIFExportDocument("adx"); writer.append(adi, 1);
  const document = writer.finish(), xml = new DOMParser().parseFromString(document, "application/xml");
  expect(xml.querySelector("parsererror")).toBeNull();
  for (const element of xml.querySelector("RECORD")!.children) expect(names.has(element.tagName), element.tagName).toBe(true);
  expect(xml.querySelector("RECORD > NAME")?.textContent).toBe("Anne");
  expect(xml.querySelectorAll("RECORD > GUEST_OP, RECORD > VE_PROV")).toHaveLength(0);
  for (const [name, value] of [["GUEST_OP", "K2ABC"], ["VE_PROV", "ON"]]) {
    expect(xml.querySelector(`RECORD > USERDEF[FIELDNAME="${name}"]`)?.textContent).toBe(value);
    expect([...xml.querySelectorAll("HEADER > USERDEF")].find(element => element.textContent === name)?.getAttribute("TYPE")).toBe("G");
  }
  const imported = decodeADIFDocument(new TextEncoder().encode(document).buffer);
  expect(imported.text).toBe(adi);
  expect(imported.fieldMetadata[0]?.extensions.GUEST_OP.kind).toBe("USERDEF");
  expect(imported.fieldMetadata[0]?.extensions.VE_PROV.kind).toBe("USERDEF");
  const replay = new ADIFExportDocument("adx"); replay.append(imported.text, 1, imported.fieldMetadata);
  expect(replay.finish()).toBe(document);
  const unchangedADI = new ADIFExportDocument("adi"); unchangedADI.append(adi, 1);
  expect(unchangedADI.finish()).toBe(adi);
});
