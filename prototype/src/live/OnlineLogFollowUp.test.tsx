// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OnlineLogFollowUpPanel, readOnlineLogFollowUp } from "./OnlineLogFollowUp";

afterEach(cleanup);
const id = "00000000-0000-4000-8000-000000000001", generation = "00000000-0000-4000-8000-000000000002";
const response = () => ({ generation, read_only: true, follow_up: { contact_id: id, contact_revision: 3, sponsor_credit: null,
  award_impact: "retainedConfirmationRequiresAwardRules", uploads: [
    { service: "qrz", state: "delivered", receipt_revision: 2, current_revision: false, last_attempt_at: "2026-10-15T12:00:00Z", attempt_age_seconds: 60, acceptance_age_seconds: null },
    { service: "club_log", state: "uncertain", receipt_revision: 3, current_revision: true, last_attempt_at: "2026-10-15T12:01:00Z", attempt_age_seconds: 0, acceptance_age_seconds: null },
  ], confirmations: [
    { source: "paper", received_status: "", received_date: null, match_age_seconds: null },
    { source: "lotw", received_status: "Y", received_date: "20261015", match_age_seconds: null },
    { source: "eqsl", received_status: "N", received_date: null, match_age_seconds: null },
  ] } });
const request = () => vi.fn(async (method: string) => {
  if (method === "logbook_contact") return { generation, contact: { generation, qso: { id } } };
  if (method === "logbook_follow_up") return response();
  throw new Error(`Unexpected method ${method}`);
});

describe("retained upload follow-up", () => {
  it("reads only on click and separates historical upload, uncertain outcome, confirmation and unknown credit", async () => {
    const call = request();
    render(<OnlineLogFollowUpPanel contactID={id} call="VK8NSB" onRequest={call} refreshKey={0} />);
    expect(call).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh retained status" }));
    await screen.findByText("Historical revision 2");
    expect(screen.getByText("Current revision 3")).toBeTruthy();
    expect(screen.getByText("Upload accepted")).toBeTruthy();
    expect(screen.getByText("Delivery uncertain — review required")).toBeTruthy();
    expect(screen.getByText("20261015")).toBeTruthy();
    expect(screen.getByText(/Sponsor credit: Unknown/)).toBeTruthy();
    expect(screen.getAllByText("Unknown")).toHaveLength(5);
    expect(call.mock.calls.map(([method]) => method)).toEqual(["logbook_contact", "logbook_follow_up"]);
    expect(call).toHaveBeenLastCalledWith("logbook_follow_up", { contactID: id, generation });
  });

  it("retires evidence after local changes without an automatic reread", async () => {
    const call = request();
    const view = render(<OnlineLogFollowUpPanel contactID={id} call="VK8NSB" onRequest={call} refreshKey={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh retained status" }));
    await screen.findByText("Historical revision 2");
    view.rerender(<OnlineLogFollowUpPanel contactID={id} call="VK8NSB" onRequest={call} refreshKey={1} />);
    expect(screen.queryByText("Historical revision 2")).toBeNull();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("discards a delayed read when the selected contact changes", async () => {
    let finish!: (value: any) => void;
    const call = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<OnlineLogFollowUpPanel contactID={id} call="VK8NSB" onRequest={call} refreshKey={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh retained status" }));
    view.rerender(<OnlineLogFollowUpPanel contactID={generation} call="OM0RX" onRequest={call} refreshKey={0} />);
    await act(async () => finish({ generation, contact: { generation, qso: { id } } }));
    expect(call).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Historical revision 2")).toBeNull();
  });

  it("rejects invented ages, credit, wrong identities and inconsistent revision scope", () => {
    const cases = [
      (value: any) => { value.follow_up.sponsor_credit = "granted"; },
      (value: any) => { value.follow_up.uploads[0].acceptance_age_seconds = 60; },
      (value: any) => { value.follow_up.confirmations[1].match_age_seconds = 60; },
      (value: any) => { value.follow_up.uploads[0].current_revision = true; },
      (value: any) => { value.follow_up.contact_id = generation; },
      (value: any) => { value.generation = id; },
    ];
    for (const change of cases) { const value = response(); change(value); expect(() => readOnlineLogFollowUp(value, id, generation)).toThrow(); }
  });
});
