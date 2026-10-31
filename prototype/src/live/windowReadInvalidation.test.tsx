// @vitest-environment jsdom
import { useEffect, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { connectLogbookChanges } from "./logbookWindows";
import { useDeferredPanelReads } from "./deferredPanelReads";
const native = vi.hoisted(() => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen, TauriEvent: {} }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

it("reloads a same-count externally edited row after the canonical native revision wake", async () => {
  vi.useFakeTimers(); let wake!: () => void;
  native.listen.mockImplementation(async (_name: string, changed: () => void) => { wake = changed; return () => {}; });
  let comment = "before external SQLite update";
  const request = vi.fn(async () => ({ qsos: [{ id: "same-contact", comment }], total: 1, offset: 0, limit: 20 }));
  let read!: ReturnType<typeof useDeferredPanelReads>;
  function Window() {
    const [revision, setRevision] = useState(0);
    useEffect(() => connectLogbookChanges(() => setRevision(value => value + 1), () => {}), []);
    read = useDeferredPanelReads(request, `workspace:settings:${revision}`, false); return null;
  }
  render(<Window />);
  await act(async () => { await vi.advanceTimersByTimeAsync(120); });
  const params = { search: "", offset: 0, limit: 20 };
  expect((await read("logbook_list", params)).qsos[0].comment).toContain("before");
  comment = "after external SQLite update";
  // Native's existing 5s summary observer sees trigger-owned logbook_revision,
  // even when count and max timestamps did not change, and emits this wake.
  await act(async () => { wake(); await vi.advanceTimersByTimeAsync(120); });
  const changed = await read("logbook_list", params);
  expect(changed.total).toBe(1); expect(changed.qsos[0].comment).toContain("after");
  expect(request).toHaveBeenCalledTimes(2);
});
