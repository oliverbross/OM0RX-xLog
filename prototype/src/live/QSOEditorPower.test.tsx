// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import QSOEditor from "./QSOEditor";
import type { DraftPowerIntent, DraftPowerState } from "./operatorDraftSession";

afterEach(cleanup);
const power = (manualOverride = false, enabled = true): DraftPowerState => ({ revision: 1, enabled, fallback: "100", manualOverride, selectedValue: "100",
  contact: { workspaceID: "00000000-0000-4000-8000-000000000001", draftID: "draft-1", call: "EA7EU", band: "20m", mode: "CW", frequencyHz: 14_025_000 } });
function Harness({ state = power(), intent, editing = false, manual = vi.fn(), automatic = vi.fn() }: {
  state?: DraftPowerState | null; intent?: DraftPowerIntent | null; editing?: boolean;
  manual?: (value: string) => void; automatic?: () => void }) {
  const [draft, setDraft] = useState<Record<string, any> | null>({ id: "draft-1", call: "EA7EU", start: "2026-10-12T10:20:30Z",
    band: "20m", mode: "CW", frequencyHz: 14_025_000, txPower: state?.selectedValue ?? "100", notes: "Keep this note.", extraFields: {} });
  return <><QSOEditor draft={draft} setDraft={setDraft} save={vi.fn()} clear={vi.fn()} busy={false} lookup={null} previous={[]} follow={false} setFollow={vi.fn()}
    powerState={state} powerIntent={intent} automaticPowerEnabled={state?.enabled ?? false} isEditing={editing}
    onManualPower={value => { manual(value); setDraft(current => current ? { ...current, txPower: value } : current); }} onResumeAutomaticPower={automatic} />
    <output data-testid="power-draft">{JSON.stringify(draft)}</output></>;
}

it("routes same-value and blank native input events through explicit manual intent", () => {
  const manual = vi.fn(); render(<Harness state={power(false, false)} manual={manual} />);
  const input = screen.getByLabelText("TX power W");
  fireEvent.input(input, { target: { value: "100" } });
  fireEvent.input(input, { target: { value: "" } });
  expect(manual.mock.calls).toEqual([["100"], [""]]);
  expect(JSON.parse(screen.getByTestId("power-draft").textContent!)).toMatchObject({ txPower: "", notes: "Keep this note." });
});

it("shows pending manual intent and offers inline automatic resume when capture is enabled", () => {
  const automatic = vi.fn(); render(<Harness state={power()} intent={{ action: "manual", value: "100" }} automatic={automatic} />);
  expect(screen.getByText("Manual override · awaiting save.")).toBeTruthy();
  const resume = screen.getByRole("button", { name: "Use automatic" });
  expect(resume.closest(".qso-power-field")?.contains(screen.getByLabelText("TX power W"))).toBe(true);
  fireEvent.click(resume); expect(automatic).toHaveBeenCalledOnce();
});

it("does not imply automatic capture is enabled when the profile is OFF", () => {
  render(<Harness state={power(true, false)} />);
  expect(screen.getByText("Manual override · automatic capture off.")).toBeTruthy();
  const resume = screen.getByRole("button", { name: "Use automatic" }) as HTMLButtonElement;
  expect(resume.disabled).toBe(true); expect(resume.title).toContain("Station settings");
});

it("labels actual captured evidence as retained and fallback/unavailable without inventing RF", () => {
  const captured = power(); captured.selectedValue = "500";
  captured.selectedSample = { source: "kpa500_output", unit: "W", watts: 500, sessionID: "00000000-0000-4000-8000-000000000002",
    observedAt: "2026-10-14T00:00:01Z", radioObservedAt: "2026-10-14T00:00:01Z", amplifierObservedAt: "2026-10-14T00:00:00Z", receivedAt: "2026-10-14T00:00:01Z" };
  const view = render(<Harness state={captured} />);
  expect(screen.getByText("Captured KPA500 output · retained for this contact.")).toBeTruthy();
  expect((screen.getByLabelText("TX power W") as HTMLInputElement).value).toBe("500");
  view.rerender(<Harness state={power()} />);
  expect(screen.getByText("Default fallback · measured output unavailable.")).toBeTruthy();
  expect(screen.queryByText(/Captured KPA500/)).toBeNull();
  view.rerender(<Harness state={null} />); expect(screen.getByText("Automatic capture off.")).toBeTruthy();
});

it("keeps logged-contact edits on their original handler and hides capture controls", () => {
  const manual = vi.fn(), automatic = vi.fn(); render(<Harness state={power(true)} editing manual={manual} automatic={automatic} />);
  fireEvent.change(screen.getByLabelText("TX power W"), { target: { value: "25" } });
  expect(JSON.parse(screen.getByTestId("power-draft").textContent!).txPower).toBe("25");
  expect(manual).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "Use automatic" })).toBeNull();
  expect(screen.queryByText(/Manual override/)).toBeNull();
});

it("does not show a previous contact's retained evidence while new contact text is unsaved", () => {
  const unrelated = power(); unrelated.contact = { ...unrelated.contact, call: "JA1ABC" };
  unrelated.selectedSample = { source: "kpa500_output", unit: "W", watts: 100, sessionID: "00000000-0000-4000-8000-000000000002",
    observedAt: "2026-10-14T00:00:01Z", radioObservedAt: "2026-10-14T00:00:01Z", amplifierObservedAt: "2026-10-14T00:00:00Z", receivedAt: "2026-10-14T00:00:01Z" };
  render(<Harness state={unrelated} />);
  expect(screen.getByText("Waiting for the current contact to be saved.")).toBeTruthy(); expect(screen.queryByText(/Captured KPA500/)).toBeNull();
});
