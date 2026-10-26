// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CWDecodePanel } from "./CWDecodePanel";
import type { CWDecodeMethod, CWDecodeSnapshot } from "./cwDecode";
import { cwDecodeFixture, cwDecodeTrackFixture } from "./cwDecode.fixtures";
afterEach(cleanup);
function service(initial = cwDecodeFixture()) {
  let current = initial;
  const request = vi.fn(async (method: CWDecodeMethod, params: Record<string, unknown> = {}): Promise<CWDecodeSnapshot> => {
    if (method === "cw_decode_configuration_save") current = { ...current, configuration: params.configuration as CWDecodeSnapshot["configuration"] };
    return structuredClone(current);
  });
  return { request, set: (next: CWDecodeSnapshot) => { current = next; } };
}
describe("CW Decode shared native view", () => {
  it("mounts and unmounts using passive reads only", async () => {
    const owner = service(), view = render(<CWDecodePanel request={owner.request} />);
    await screen.findByText("No live signals");
    expect(owner.request.mock.calls.every(([method]) => method === "cw_decode_snapshot")).toBe(true);
    view.unmount();
    expect(owner.request.mock.calls.some(([method]) => method.includes("start") || method.includes("stop"))).toBe(false);
  });
  it("saves an explicit source edit against its original revision", async () => {
    const owner = service(); render(<CWDecodePanel request={owner.request} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sources & server" }));
    fireEvent.change(screen.getByLabelText("Sample rate"), { target: { value: "48000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save CW Decode settings" }));
    await waitFor(() => expect(owner.request.mock.calls.some(([method]) => method === "cw_decode_configuration_save")).toBe(true));
    const params = owner.request.mock.calls.find(([method]) => method === "cw_decode_configuration_save")![1]!;
    expect(params.expected_revision).toBe(cwDecodeFixture().configuration.revision);
    expect((params.configuration as any).sources[0].sampleRate).toBe(48000);
    expect(owner.request.mock.calls.some(([method]) => method === "cw_decode_start")).toBe(false);
  });
  it("Stop can cancel an in-flight Start and a late reply cannot restore running UI", async () => {
    const owner = service(); let finish!: (value: CWDecodeSnapshot) => void;
    const request = vi.fn(async (method: CWDecodeMethod, params?: Record<string, unknown>) => method === "cw_decode_start"
      ? new Promise<CWDecodeSnapshot>(resolve => { finish = resolve; }) : owner.request(method, params));
    render(<CWDecodePanel request={request} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start decoding" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    fireEvent.click(screen.getByRole("button", { name: /^Stop$/ }));
    await waitFor(() => expect(request.mock.calls.some(([method]) => method === "cw_decode_stop")).toBe(true));
    await act(async () => { finish(cwDecodeTrackFixture()); await Promise.resolve(); });
    expect(screen.getByText("Stopped", { selector: ".cw-decode-state" })).toBeTruthy();
  });
  it("shows provisional copy separately and never makes unknown metrics or RF frequency authoritative", async () => {
    const owner = service(cwDecodeTrackFixture()); render(<CWDecodePanel request={owner.request} />);
    await screen.findByText("CQ TEST K1ABC K1ABC");
    expect(screen.getByLabelText("Provisional text").textContent).toBe("CQ TE");
    expect(screen.getByText("RF unqualified")).toBeTruthy();
    expect(screen.getByTitle("Speed has not been measured").textContent).toBe("—");
    fireEvent.click(screen.getByRole("button", { name: /Inspect signal/ }));
    expect((screen.getByLabelText("Committed text") as HTMLTextAreaElement).value).toContain("K1ABC K1ABC");
    expect(owner.request.mock.calls.every(([method]) => method === "cw_decode_snapshot")).toBe(true);
  });
  it("retains a command error across a successful state poll", async () => {
    const owner = service(), request = vi.fn(async (method: CWDecodeMethod, params?: Record<string, unknown>) => {
      if (method === "cw_decode_start") throw new Error("IQ resource is occupied. Choose another source.");
      return owner.request(method, params);
    });
    render(<CWDecodePanel request={request} />);
    fireEvent.click(await screen.findByRole("button", { name: "Start decoding" }));
    await screen.findByText("IQ resource is occupied. Choose another source.");
    await act(async () => { window.dispatchEvent(new Event("focus")); await Promise.resolve(); });
    expect(screen.getByText("IQ resource is occupied. Choose another source.")).toBeTruthy();
  });
});
