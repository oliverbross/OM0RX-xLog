// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createRef } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ContestCandidates, ContestEntryFields, ContestLogTable, ContestScoreSummary, ContestTextField, type ContestLogRow } from "./ContestPresentation";

afterEach(cleanup);

it.each([false, true])("preserves controlled entry fields and focus in detached=%s", detached => {
  const input = createRef<HTMLInputElement>(), changed = vi.fn();
  render(<ContestEntryFields detached={detached}
    callsign={<ContestTextField label="Callsign" inputRef={input} value="K1ABC" autoComplete="off"
      data-contest-operator-field="callsign" onChange={event => changed(event.target.value)}/>}
    reports={<ContestTextField label="Report" defaultValue="599"/>}
    exchange={<ContestTextField label="Zone" defaultValue="15" required/>}/>);
  expect(input.current).toBe(screen.getByLabelText("Callsign"));
  input.current!.focus(); expect(document.activeElement).toBe(input.current);
  fireEvent.change(input.current!, { target: { value: "K1AB" } });
  expect(changed).toHaveBeenCalledExactlyOnceWith("K1AB");
  expect(input.current!.value).toBe("K1ABC");
  expect(screen.getByLabelText("Zone").hasAttribute("required")).toBe(true);
});

it("keeps candidate identity and disablement in the shared Check renderer", () => {
  const selected = vi.fn(), candidates = [{ id: "candidate-1", label: "K1ABC", detail: "Zone: 5" }];
  const view = render(<ContestCandidates candidates={candidates} disabled={false} onSelect={selected}/>);
  expect(selected).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "K1ABCZone: 5" }));
  expect(selected).toHaveBeenCalledExactlyOnceWith("candidate-1");
  view.rerender(<ContestCandidates candidates={candidates} disabled onSelect={selected}/>);
  fireEvent.click(screen.getByRole("button")); expect(selected).toHaveBeenCalledTimes(1);
});

const row: ContestLogRow = { qsoID: "qso-1", workedAt: "2026-10-19T01:23:45Z", callsign: "K1ABC", band: "20m", mode: "CW",
  sentExchange: "15", receivedExchange: "5", points: 3, multiplierLabels: ["United States"] };
it.each([false, true])("keeps the existing log columns and edit destination in detached=%s", detached => {
  const edit = vi.fn(); render(<ContestLogTable rows={[row]} disabled={false} onEdit={edit} detached={detached}/>);
  expect(screen.getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(detached
    ? ["UTC", "Call", "Band", "Mode", "Exchange", "Pts"]
    : ["UTC", "Call", "Band", "Sent", "Received", "Pts", "Mult", "Actions"]);
  expect(edit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: detached ? "K1ABC" : "Edit K1ABC" }));
  expect(edit).toHaveBeenCalledExactlyOnceWith("qso-1");
  expect(within(screen.getAllByRole("row")[1]).getByText(detached ? "01:23:45" : "2026-10-19 01:23")).toBeTruthy();
});

it("shares score values while preserving empty and repeated multiplier presentation", () => {
  const score = { claimedScore: 12, qsos: 2, points: 6, multipliers: 2,
    multiplierLabels: ["a", "b"], multiplierDisplayLabels: ["Zone 5", "Zone 5"], sourceVerification: "verified" };
  const view = render(<ContestScoreSummary score={score}/>);
  expect(screen.getAllByText("Zone 5")).toHaveLength(2); expect(screen.getByText("12")).toBeTruthy();
  view.rerender(<ContestScoreSummary score={null} detached/>);
  expect(screen.getByText("No score available.")).toBeTruthy();
  view.rerender(<ContestScoreSummary score={null}/>);
  expect(screen.getByText("No multipliers recorded.")).toBeTruthy();
});

it("labels incomplete scoring as a known partial total", () => {
  render(<ContestScoreSummary score={{ claimedScore:7,qsos:1,points:7,multipliers:1,
    multiplierLabels:["Brazilian UF is unavailable"],multiplierDisplayLabels:["Brazilian UF is unavailable"],
    sourceVerification:"unverified",scoringComplete:false }} detached/>);
  expect(screen.getByText("Known score (partial)")).toBeTruthy();
  expect(screen.getByText("Brazilian UF is unavailable")).toBeTruthy();
  expect(screen.queryByText("Claimed score")).toBeNull();
});
