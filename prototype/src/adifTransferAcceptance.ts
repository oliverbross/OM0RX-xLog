import { ADIFExportDocument, decodeADIFDocument } from "./live/adifTransfer";

type Json = Record<string, any>;
type Worker = (method: string, params?: Json) => Promise<Json>;

function adifField(name: string, value: string): string {
  return `<${name}:${new TextEncoder().encode(value).length}>${value}`;
}

/** Exercise the bundled transfer codec against the isolated native workspace. */
export async function verifyADIFTransferRoundtrip(worker: Worker) {
  const started = (await worker("logbook_export_adif", { action: "begin", scope: "all" })).result;
  if (started.total !== 1 || typeof started.token !== "string" || !started.token) throw new Error("Acceptance export did not freeze one contact");
  const frame = (await worker("logbook_export_adif", { action: "read", token: started.token, offset: 0, limit: 25 })).result;
  if (frame.count !== 1 || frame.total !== 1 || typeof frame.text !== "string" || !Array.isArray(frame.fieldMetadata)) {
    throw new Error("Acceptance export frame is incomplete");
  }

  const schemaFields = [
    adifField("MS_SHOWER", "PERSEIDS"),
    adifField("COMMENT_INTL", "Žilina 😀"),
    adifField("CREDIT_GRANTED", "DXCC:LOTW,CQWPX_BAND:CARD&EQSL"),
    adifField("AWARD_GRANTED", "ARRL_DXCC_MIXED"),
  ].join("");
  const typedFrame = frame.text.replace("<EOR>", `${schemaFields}<EOR>`);
  if (typedFrame === frame.text) throw new Error("Acceptance export record has no terminator");

  const writer = new ADIFExportDocument("adx");
  writer.append(typedFrame, frame.count, frame.fieldMetadata);
  const adx = writer.finish();
  const decoded = decodeADIFDocument(new TextEncoder().encode(adx).buffer);
  const expected = typedFrame.replace("<ADIF_VER:5>3.1.7<EOH>\r\n", "");
  if (expected === typedFrame || decoded.text !== expected || JSON.stringify(decoded.fieldMetadata) !== JSON.stringify(frame.fieldMetadata)) {
    throw new Error(`Packaged ADX roundtrip changed the frozen record: ${JSON.stringify({ expected, actual: decoded.text,
      expectedMetadata: frame.fieldMetadata, actualMetadata: decoded.fieldMetadata })}`);
  }

  const preview = (await worker("logbook_import_adif", {
    action: "preview", text: decoded.text, chunk: 0, fieldMetadata: decoded.fieldMetadata,
  })).result;
  if (preview.records !== 1 || preview.duplicates !== 1 || preview.inserts !== 0 || !Array.isArray(preview.issues) || preview.issues.length ||
      typeof preview.token !== "string" || typeof preview.generation !== "string") {
    throw new Error("Packaged ADX preview did not protect the existing contact");
  }
  const applied = (await worker("logbook_import_adif", {
    text: decoded.text, generation: preview.generation, fieldMetadata: decoded.fieldMetadata,
  })).result;
  const after = (await worker("logbook_list")).result;
  if (applied.imported !== 0 || applied.skipped_duplicates !== 1 || after.total !== 1) {
    throw new Error("Packaged ADX duplicate import changed the isolated logbook");
  }
  return { exported: frame.count, adxBytes: new TextEncoder().encode(adx).length, previewDuplicates: preview.duplicates,
    imported: applied.imported, skippedDuplicates: applied.skipped_duplicates, finalContacts: after.total };
}
