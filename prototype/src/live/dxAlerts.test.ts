// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { checkedDxAlerts, clearSelectedDxAlerts, connectDxAlerts } from "./dxAlerts";
const native = vi.hoisted(() => ({ invoke:vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke:native.invoke }));
const frame = () => ({ epoch:"00000000-0000-4000-8000-000000000001", revision:1,
  configuration:{ generation:"00000000-0000-4000-8000-000000000002", revision:0, enabled:false, dedupSeconds:120, retentionMinutes:120, nativePopup:false, notificationSound:false,
    rules:[{ id:"new-dxcc", name:"New DXCC", enabled:true, callsignGlob:"*", commentContains:"", bands:[], modes:[], callStatuses:[], dxccStatuses:["New DXCC"], specials:[] }] },
  storageError:null, source:{ available:true, baselined:true, revision:1, receivedAtMs:1 }, entries:[], delivery:{ error:null, suppressed:0, maximumPerWindow:3, windowSeconds:10 }, limits:{ maximumRules:32, maximumEntries:200 } });
it("accepts the bounded native snapshot and rejects malformed identities", () => {
  expect(checkedDxAlerts(frame()).configuration.enabled).toBe(false);
  expect(checkedDxAlerts(frame()).configuration.rules[0].id).toBe("new-dxcc");
  expect(() => checkedDxAlerts({ ...frame(), epoch:"bad" })).toThrow("could not be verified");
});
it("accepts explicit CQ sources and rejects unknown sources or malformed activity health", () => {
  const value = frame(); Object.assign(value.configuration.rules[0], { sources:["wsjtx"] });
  Object.assign(value, { activitySource:{ available:true, baselined:true, revision:2, classificationRevision:3, receivedAtMs:10 } });
  expect(checkedDxAlerts(value).configuration.rules[0].sources).toEqual(["wsjtx"]);
  expect(checkedDxAlerts(value).activitySource?.classificationRevision).toBe(3);
  for (const sources of [[], ["reply"], ["wsjtx", "wsjtx"]]) {
    Object.assign(value.configuration.rules[0], { sources });
    expect(() => checkedDxAlerts(value)).toThrow("could not be verified");
  }
  Object.assign(value.configuration.rules[0], { sources:["cluster"] });
  Object.assign(value, { activitySource:{ available:true, baselined:true, revision:-1, receivedAtMs:10 } });
  expect(() => checkedDxAlerts(value)).toThrow("could not be verified");
  Object.assign(value, { activitySource:{ available:true, baselined:true, revision:2, classificationRevision:-1, receivedAtMs:10 } });
  expect(() => checkedDxAlerts(value)).toThrow("could not be verified");
});
it("uses native wakes and focus recovery without polling", async () => {
  const read=vi.fn().mockResolvedValue(frame()), listen=vi.fn(async () => vi.fn()), changed=vi.fn(), failed=vi.fn();
  const dispose=connectDxAlerts(changed,failed,{ read,listen }); await Promise.resolve(); await Promise.resolve();
  expect(read).toHaveBeenCalledTimes(1); expect(listen).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledWith(frame()); expect(failed).not.toHaveBeenCalled(); dispose();
});
it("rejects malformed and oversized comment conditions at the native boundary", () => {
  for (const commentContains of [null, " ", "POTA\n", "é".repeat(41), "x".repeat(81)]) {
    const value = frame();
    Object.assign(value.configuration.rules[0], { commentContains });
    expect(() => checkedDxAlerts(value)).toThrow("could not be verified");
  }
  const value = frame(); value.configuration.rules[0].commentContains = " POTA ";
  expect(checkedDxAlerts(value).configuration.rules[0].commentContains).toBe(" POTA ");
});
it("clears exact selected identities with the displayed owner epoch and validates the response", async () => {
  native.invoke.mockReset().mockResolvedValue(frame());
  const ids = ["00000000-0000-4000-8000-000000000003"];
  expect(await clearSelectedDxAlerts(frame(), ids)).toEqual(frame());
  expect(native.invoke).toHaveBeenCalledExactlyOnceWith("dx_alerts_clear_selected", { expectedEpoch:frame().epoch, ids });
  native.invoke.mockResolvedValue({ ...frame(), epoch:"bad" });
  await expect(clearSelectedDxAlerts(frame(), ids)).rejects.toThrow("could not be verified");
});
