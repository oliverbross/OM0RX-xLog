// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QSOEditor } from "./QSOEditorCore";
import { DeskQSO } from "./OperatorDesk";
import { validDraftSnapshot } from "./operatorDraftSession";
import { effectiveDraftAutomaticStart } from "./operatorDraftTimeIntent";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const initial = { id: "fixture", call: "K1ABC", start: "2026-10-20T10:15:30Z", end: null,
  band: "20m", mode: "CW", frequencyHz: 14_025_000, rstSent: "599", rstReceived: "599", extraFields: {} };
function Harness({ full, automaticStart, save, deriveAutomatic = false }: { full: boolean; automaticStart: boolean; save: (value?: any) => void; deriveAutomatic?: boolean }) {
  const [draft, setDraft] = useState<Record<string, any> | null>(initial);
  const effectiveAutomatic = deriveAutomatic ? effectiveDraftAutomaticStart({base:{revision:0,qso:initial,automaticStart},draft:draft&&{...draft,id:draft.id}}) : automaticStart;
  const props = { draft, setDraft, save, clear: vi.fn(), busy: false, automaticStart:effectiveAutomatic,
    lookup: null, previous: [], follow: false, setFollow: vi.fn(), request: vi.fn(async () => ({ cells: [] })), refresh: 0 };
  return <><output aria-label="Effective automatic time">{String(effectiveAutomatic)}</output>{full ? <QSOEditor {...props} inspector={false} radioControls={false} /> : <DeskQSO {...props} radioControls={false} />}</>;
}

it.each([true,false])("reconciles reversed UTC immediately with automatic intent before blur or a clock tick (full=%s)",full=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-28T12:34:56Z"));
  const save=vi.fn();render(<Harness full={full} automaticStart deriveAutomatic save={save}/>);
  const date=screen.getByLabelText(full?"Start UTC date":"Desk UTC date") as HTMLInputElement;
  const time=screen.getByLabelText(full?"Start UTC time":"Desk UTC time") as HTMLInputElement;
  fireEvent.change(date,{target:{value:"2026-10-21"}});
  fireEvent.change(time,{target:{value:"10:15:30"}});
  expect(screen.getByLabelText("Effective automatic time").textContent).toBe("false");
  fireEvent.change(date,{target:{value:"2026-10-20"}});
  expect(screen.getByLabelText("Effective automatic time").textContent).toBe("true");
  expect(date.value).toBe("2026-10-28");expect(time.value).toBe("12:34:56");
  fireEvent.click(screen.getByRole("button",{name:"Log QSO"}));
  expect(save).toHaveBeenCalledExactlyOnceWith(initial);
});

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
  expect(validDraftSnapshot({ ...snapshot, automaticStart: true })).toBe(true);
  expect(validDraftSnapshot({ ...snapshot, automaticStart: false })).toBe(true);
  expect(validDraftSnapshot({ ...snapshot, automaticStart: "false" })).toBe(false);
});

it.each([null, 0, 1, NaN, [], {}, "true", new Boolean(false)])(
  "rejects non-boolean canonical time provenance %j", automaticStart => {
    expect(validDraftSnapshot({ revision: 1, qso: initial, automaticStart })).toBe(false);
  });
