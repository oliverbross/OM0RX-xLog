import { beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ framedWorkerRequest: vi.fn() }));
vi.mock("./worker", () => bridge);

import { integratedAcceptanceWorker } from "./integratedAcceptance";

beforeEach(() => bridge.framedWorkerRequest.mockReset());

it("uses the operation-context-aware worker bridge during native acceptance", async () => {
  bridge.framedWorkerRequest.mockResolvedValue({ id: "accepted", ok: true, result: { imported: 0 } });

  await expect(integratedAcceptanceWorker("logbook_import_adif", { action: "preview" }))
    .resolves.toEqual({ id: "accepted", ok: true, result: { imported: 0 } });
  expect(bridge.framedWorkerRequest).toHaveBeenCalledExactlyOnceWith(
    "logbook_import_adif", { action: "preview" },
  );
});
