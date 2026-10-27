// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ContestMessageWorkbench, exportNot1MMBank, type ContestMessageWorkbenchProps, type MessageBank } from "./ContestMessageWorkbench";

afterEach(cleanup);
const scope = { mode: "CW", contest: "cq_ww_cw", operator: "OM0RX" };
function bank(): MessageBank {
  return { id: "saved-bank", name: "Weekend", scope, dialect: "not1mm", original: "R|F1|CQ|CQ {MYCALL}",
    macros: [{ mode: "R", key: "F1", label: "CQ", template: "CQ {MYCALL}" }] };
}
function props(): ContestMessageWorkbenchProps {
  return { scope, effectiveMacros: [{ mode: "R", key: "F1", label: "CQ", template: "CQ {MYCALL}" }],
    draft: { id: "entry-a", fields: { callsign: "K1ABC" } }, serial: 42,
    request: vi.fn(async method => method === "contest_message_banks" ? { banks: [bank()], activeBankID: null } : {}),
    onMutate: vi.fn(async () => ({})), onExport: vi.fn(async () => undefined) };
}
it("renders both F1–F12 banks and keeps save, activate and export separate", async () => {
  const p = props(); render(<ContestMessageWorkbench {...p}/>);
  expect(screen.getByLabelText("R F12 message template")).toBeTruthy();
  expect(screen.getByLabelText("S F12 message template")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("R F1 message template"), { target: { value: "NEW {CALL}" } });
  fireEvent.click(screen.getByRole("button", { name: "Save named bank" }));
  await waitFor(() => expect(p.onMutate).toHaveBeenCalledTimes(1));
  expect(p.onMutate).toHaveBeenCalledWith("contest_message_bank_save", expect.objectContaining({ bank: expect.objectContaining({ name: "My messages" }) }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Export Not1MM file" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Export Not1MM file" }));
  await waitFor(() => expect(p.onExport).toHaveBeenCalledWith(expect.stringContaining("R|F1|CQ|NEW {CALL}"), "messages-not1mm.txt"));
  expect(p.onMutate).toHaveBeenCalledTimes(1);
});
it("stages an explicit dialect with rejected rows visible and Save blocked", async () => {
  const p = props();
  p.request = vi.fn(async method => method === "contest_message_import"
    ? { bank: { ...bank(), original: "# Run\nF1 bad,{SHELL}" }, canSave: false, report: [{ line: 2, status: "rejected", message: "Shell unsupported" }] }
    : { banks: [], activeBankID: null });
  render(<ContestMessageWorkbench {...p}/>);
  fireEvent.change(screen.getByLabelText("File dialect"), { target: { value: "n1mm" } });
  fireEvent.change(screen.getByLabelText("Original source"), { target: { value: "# Run\nF1 bad,{SHELL}" } });
  fireEvent.click(screen.getByRole("button", { name: "Stage import and report" }));
  await waitFor(() => expect(screen.getByLabelText("Import report").textContent).toContain("Shell unsupported"));
  expect(p.request).toHaveBeenCalledWith("contest_message_import", expect.objectContaining({ dialect: "n1mm" }));
  expect((screen.getByRole("button", { name: "Save named bank" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Retained original import")).toBeTruthy();
  expect(p.onMutate).not.toHaveBeenCalled();
});
it("binds preview to supplied next call and simulated serial and never mutates", async () => {
  const p = props();
  p.request = vi.fn(async (method, params) => method === "contest_message_preview" ? {
    text: params.draft && "{#^<XML> 43", noOutput: true, warnings: ["CW output unavailable"], rejections: [], actions: [],
    binding: { draftID: "entry-a", serial: 43 }, nextESM: { keys: ["F12"], basis: "Current plugin projection highlights", warning: "Current-entry suggestion only" },
  } : { banks: [], activeBankID: null });
  render(<ContestMessageWorkbench {...p}/>);
  fireEvent.change(screen.getByLabelText("Synthetic / next call"), { target: { value: "{#^<XML>" } });
  fireEvent.change(screen.getByLabelText("Simulated serial"), { target: { value: "43" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview without output" }));
  await waitFor(() => expect(screen.getByLabelText("Rendered message preview").textContent).toBe("{#^<XML> 43"));
  expect(p.request).toHaveBeenCalledWith("contest_message_preview", expect.objectContaining({ serial: 43, draft: { id: "entry-a", fields: { callsign: "{#^<XML>" } } }));
  expect(p.onMutate).not.toHaveBeenCalled();
  expect(p.onExport).not.toHaveBeenCalled();
});
it("exports all 24 Not1MM rows without mutating the draft", () => {
  const value = bank(), before = structuredClone(value), result = exportNot1MMBank(value);
  expect(result.trim().split("\n")).toHaveLength(24);
  expect(result).toContain("S|F12||\n");
  expect(value).toEqual(before);
});
