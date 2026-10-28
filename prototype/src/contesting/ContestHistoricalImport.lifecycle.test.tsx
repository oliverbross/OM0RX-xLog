// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { ContestHistoricalImport } from "./ContestHistoricalImport";

const parser = vi.hoisted(() => vi.fn());
vi.mock("./contestAdifImport", () => ({ historicalADIFRecords: (...args: unknown[]) => parser(...args) }));
type Props = ComponentProps<typeof ContestHistoricalImport>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function props(): Props {
  return { scope: { sessionID: "one", workspaceGeneration: "private", revision: 1 }, disabled: false,
    request: vi.fn() as unknown as Props["request"], onApply: vi.fn(async () => {}) };
}
function choose(bytes: Promise<ArrayBuffer>) {
  const file = new File(["fixture"], "fixture.adi");
  Object.defineProperty(file, "arrayBuffer", { value: () => bytes });
  fireEvent.change(screen.getByLabelText("Historical ADIF file"), { target: { files: [file] } });
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("revision invalidation immediately retires an outstanding file read", async () => {
  const data = deferred<ArrayBuffer>(), p = props();
  parser.mockResolvedValue([{ raw: { CALL: "OLD" }, metadata: null, sourceSHA256: "old" }]);
  const view = render(<ContestHistoricalImport {...p}/>);
  choose(data.promise);
  expect((screen.getByLabelText("Historical ADIF file") as HTMLInputElement).disabled).toBe(true);
  view.rerender(<ContestHistoricalImport {...p} scope={{ ...p.scope, revision: 2 }}/>);
  expect((screen.getByLabelText("Historical ADIF file") as HTMLInputElement).disabled).toBe(false);
  await act(async () => { data.resolve(new ArrayBuffer(0)); await data.promise; });
  expect(screen.getByRole("status").textContent).toContain("0 decoded");
  expect((screen.getByLabelText("Historical ADIF file") as HTMLInputElement).disabled).toBe(false);
});

it("changing session invalidates old reads without leaving the next session busy", async () => {
  const data = deferred<ArrayBuffer>(), p = props();
  parser.mockResolvedValue([]);
  const view = render(<ContestHistoricalImport {...p}/>);
  choose(data.promise);
  view.rerender(<ContestHistoricalImport {...p} scope={{ ...p.scope, sessionID: "two" }}/>);
  expect((screen.getByLabelText("Historical ADIF file") as HTMLInputElement).disabled).toBe(false);
  await act(async () => { data.resolve(new ArrayBuffer(0)); await data.promise; });
  expect((screen.getByLabelText("Historical ADIF file") as HTMLInputElement).disabled).toBe(false);
});

it("a revision advance during Apply does not release Apply's busy state", async () => {
  const applied = deferred<void>(), p = props();
  parser.mockResolvedValue([{ raw: { CALL: "K1ABC" }, metadata: null, sourceSHA256: "hash" }]);
  p.request = vi.fn(async () => ({ id: "review", ok: true, result: { qsoID: "qso", status: "ready", family: "serial",
    timestamp: "2026-10-28 12:00:00", fields: { callsign: "K1ABC" }, frequencyHz: 14025000, radioAttribution: "unknown" } })) as unknown as Props["request"];
  p.onApply = vi.fn(() => applied.promise);
  const view = render(<ContestHistoricalImport {...p}/>);
  choose(Promise.resolve(new ArrayBuffer(0)));
  await waitFor(() => expect((screen.getByRole("button", { name: "Review all source contacts" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Review all source contacts" }));
  fireEvent.click(await screen.findByRole("button", { name: "Apply reviewed historical contacts" }));
  expect(p.onApply).toHaveBeenCalledOnce();
  view.rerender(<ContestHistoricalImport {...p} scope={{ ...p.scope, revision: 2 }}/>);
  expect((screen.getByLabelText("Historical ADIF file") as HTMLInputElement).disabled).toBe(true);
  await act(async () => { applied.resolve(); await applied.promise; });
  expect((screen.getByLabelText("Historical ADIF file") as HTMLInputElement).disabled).toBe(false);
});
