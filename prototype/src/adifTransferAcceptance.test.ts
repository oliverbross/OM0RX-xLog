// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { verifyADIFTransferRoundtrip } from "./adifTransferAcceptance";

const record = "<ADIF_VER:5>3.1.7<EOH>\r\n<CALL:4>W1AW<QSO_DATE:8>20261014<TIME_ON:6>000000<BAND:3>20m<MODE:2>CW<EOR>\r\n";

it("roundtrips a frozen native export through bundled ADX and skips its duplicate import", async () => {
  const worker = vi.fn(async (method: string, params: Record<string, any> = {}) => {
    if (method === "logbook_export_adif" && params.action === "begin") return { result: { token: "frozen", total: 1 } };
    if (method === "logbook_export_adif") return { result: { text: record, count: 1, total: 1, fieldMetadata: [null] } };
    if (method === "logbook_import_adif" && params.action === "preview") return { result: {
      records: 1, duplicates: 1, inserts: 0, issues: [], token: "preview", generation: "workspace-1",
    } };
    if (method === "logbook_import_adif") return { result: { imported: 0, skipped_duplicates: 1 } };
    if (method === "logbook_list") return { result: { total: 1 } };
    throw new Error(`Unexpected method ${method}`);
  });
  await expect(verifyADIFTransferRoundtrip(worker)).resolves.toEqual({
    exported: 1, adxBytes: expect.any(Number), previewDuplicates: 1, imported: 0, skippedDuplicates: 1, finalContacts: 1,
  });
  const previewCall = worker.mock.calls.find(([method, params]) => method === "logbook_import_adif" && params?.action === "preview");
  expect(previewCall).toBeTruthy();
  const preview = previewCall![1]!;
  expect(preview.text).toContain("<MS_SHOWER:8>PERSEIDS");
  expect(preview.text).toContain("<COMMENT_INTL:12>Žilina 😀");
  expect(preview.text).toContain("<CREDIT_GRANTED:30>DXCC:LOTW,CQWPX_BAND:CARD&EQSL");
  expect(preview.text).toContain("<AWARD_GRANTED:15>ARRL_DXCC_MIXED");
});

it("fails closed before import when the frozen export frame is incomplete", async () => {
  const worker = vi.fn(async () => ({ result: { token: "frozen", total: 2 } }));
  await expect(verifyADIFTransferRoundtrip(worker)).rejects.toThrow("freeze one contact");
  expect(worker).toHaveBeenCalledTimes(1);
});
