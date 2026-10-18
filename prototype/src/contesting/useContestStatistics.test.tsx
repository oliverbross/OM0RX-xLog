// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ContestSessionSummary, ContestStatistics } from "./types";
import { useContestStatistics } from "./useContestStatistics";

const session = (revision: number) => ({ sessionID: "session", workspaceGeneration: "generation", revision } as ContestSessionSummary);
const stats = (revision: number) => ({ sessionID: "session", workspaceGeneration: "generation", revision, asOfUTC: "2026-10-18T00:00:00.000Z" } as ContestStatistics);
function Harness({ client, current }: { client: { statistics: (session: ContestSessionSummary) => Promise<ContestStatistics> }; current: ContestSessionSummary }) {
  const value = useContestStatistics(client as never, current, true, 1_000_000);
  return <div>{value.statistics ? `revision ${value.statistics.revision}` : "unavailable"}{value.error && <span>{value.error}</span>}</div>;
}
afterEach(()=>{cleanup();vi.useRealTimers();});

it("ignores a delayed old-session read and retains a valid sample across a same-coordinate refresh failure", async () => {
  let oldResolve!:(value:ContestStatistics)=>void, newResolve!:(value:ContestStatistics)=>void;
  const client={statistics:vi.fn((value:ContestSessionSummary)=>new Promise<ContestStatistics>(resolve=>{if(value.revision===1)oldResolve=resolve;else newResolve=resolve;}))};
  const view=render(<Harness client={client} current={session(1)}/>);view.rerender(<Harness client={client} current={session(2)}/>);
  newResolve(stats(2));await screen.findByText("revision 2");oldResolve(stats(1));await Promise.resolve();expect(screen.queryByText("revision 1")).toBeNull();
  cleanup();const failing={statistics:vi.fn().mockResolvedValueOnce(stats(2)).mockRejectedValueOnce(new Error("clock unavailable"))};
  vi.useFakeTimers();render(<Harness client={failing} current={session(2)}/>);await act(async()=>{await Promise.resolve();});expect(screen.getByText("revision 2")).toBeTruthy();
  await act(async()=>{await vi.advanceTimersByTimeAsync(1_000_000);});expect(screen.getByText("clock unavailable")).toBeTruthy();expect(screen.getByText(/revision 2/)).toBeTruthy();
});
