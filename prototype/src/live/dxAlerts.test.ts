// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { checkedDxAlerts, connectDxAlerts } from "./dxAlerts";
const frame = () => ({ epoch:"00000000-0000-4000-8000-000000000001", revision:1,
  configuration:{ generation:"00000000-0000-4000-8000-000000000002", revision:0, enabled:false, dedupSeconds:120, retentionMinutes:120,
    rules:[{ id:"00000000-0000-4000-8000-000000000003", name:"New DXCC", enabled:true, callsignGlob:"*", bands:[], modes:[], callStatuses:[], dxccStatuses:["ATNO"], specials:[] }] },
  storageError:null, source:{ available:true, baselined:true, revision:1, receivedAtMs:1 }, entries:[], limits:{ maximumRules:32, maximumEntries:200 } });
it("accepts the bounded native snapshot and rejects malformed identities", () => {
  expect(checkedDxAlerts(frame()).configuration.enabled).toBe(false);
  expect(() => checkedDxAlerts({ ...frame(), epoch:"bad" })).toThrow("could not be verified");
});
it("uses native wakes and focus recovery without polling", async () => {
  const read=vi.fn().mockResolvedValue(frame()), listen=vi.fn(async () => vi.fn()), changed=vi.fn(), failed=vi.fn();
  const dispose=connectDxAlerts(changed,failed,{ read,listen }); await Promise.resolve(); await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(1); expect(listen).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledWith(frame()); expect(failed).not.toHaveBeenCalled(); dispose();
});
