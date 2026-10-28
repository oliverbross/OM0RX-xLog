// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QSOEditor } from "./QSOEditorCore";
import { DeskQSO } from "./OperatorDesk";
import { validDraftSnapshot } from "./operatorDraftSession";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const initial = { id: "fixture", call: "K1ABC", start: "2026-10-20T10:15:30Z", end: null,
  band: "20m", mode: "CW", frequencyHz: 14_025_000, rstSent: "599", rstReceived: "599", extraFields: {} };
function Harness({ full, automaticStart, save }: { full: boolean; automaticStart: boolean; save: (value?: any) => void }) {
  const [draft, setDraft] = useState<Record<string, any> | null>(initial);
  const props = { draft, setDraft, save, clear: vi.fn(), busy: false, automaticStart,
    lookup: null, previous: [], follow: false, setFollow: vi.fn(), request: vi.fn(async () => ({ cells: [] })), refresh: 0 };
  return full ? <QSOEditor {...props} inspector={false} radioControls={false} /> : <DeskQSO {...props} radioControls={false} />;
}

it.each([false, true])("leaves canonical automatic start for native Save (full=%s)", full => {
  vi.setSystemTime(new Date("2026-10-28T12:34:56Z"));
  const save = vi.fn(); render(<Harness full={full} automaticStart save={save} />);
  expect((screen.getByLabelText(full ? "Start UTC time" : "Desk UTC time") as HTMLInputElement).value).toBe("12:34:56");
  fireEvent.click(screen.getByRole("button", { name: "Log QSO" }));
  expect(save).toHaveBeenCalledWith(initial);
});

it.each([false, true])("shows and submits retained manual time after remount (full=%s)", full => {
  vi.setSystemTime(new Date("2026-10-28T12:34:56Z"));
  const save = vi.fn(); render(<Harness full={full} automaticStart={false} save={save} />);
  expect((screen.getByLabelText(full ? "Start UTC time" : "Desk UTC time") as HTMLInputElement).value).toBe("10:15:30");
  fireEvent.click(screen.getByRole("button", { name: "Log QSO" }));
  expect(save).toHaveBeenCalledWith(initial);
});

it("accepts legacy provenance omission, preserves explicit false, and rejects malformed provenance", () => {
  const snapshot = { revision: 1, qso: initial };
  expect(validDraftSnapshot(snapshot)).toBe(true);
  expect(validDraftSnapshot({ ...snapshot, automaticStart: false })).toBe(true);
  expect(validDraftSnapshot({ ...snapshot, automaticStart: "false" })).toBe(false);
});
