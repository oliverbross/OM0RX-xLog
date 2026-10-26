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
  it("shows existing opportunity annotations and keeps unavailable classification explicit", async () => {
    const fixture=cwDecodeTrackFixture();fixture.tracks[0].opportunity={callStatus:"Worked",dxccStatus:"Confirmed"};
    const owner=service(fixture);render(<CWDecodePanel request={owner.request} />);
    await screen.findByText("Worked");expect(screen.getByText("DXCC Confirmed")).toBeTruthy();
    expect(screen.getByRole("columnheader",{name:"Opportunity"})).toBeTruthy();
    expect(owner.request.mock.calls.every(([method])=>method==="cw_decode_snapshot")).toBe(true);
  });
  it("mutes a call-less track only on explicit native-reference intent", async () => {
    const fixture = cwDecodeTrackFixture(), track = fixture.tracks[0]; fixture.featureEnabled = true;
    track.controlReference = { sessionID: track.descriptor.sessionID, sourceID: track.sourceID, streamToken: track.descriptor.streamToken,
      epoch: track.descriptor.epoch, trackID: track.trackID, revision: track.revision, selectionID: "60000000-0000-0000-0000-000000000001" };
    const owner = service(fixture); render(<CWDecodePanel request={owner.request} />);
    fireEvent.click(await screen.findByRole("button", { name: /Inspect signal/ }));
    expect(owner.request.mock.calls.every(([method]) => method === "cw_decode_snapshot")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Prioritize track" }));
    await waitFor(() => expect(owner.request.mock.calls.some(([method]) => method === "cw_decode_track_focus")).toBe(true));
    expect(owner.request.mock.calls.find(([method]) => method === "cw_decode_track_focus")![1]).toEqual({ reference: track.controlReference });
    fireEvent.click(screen.getByRole("button", { name: "Mute track" }));
    await waitFor(() => expect(owner.request.mock.calls.some(([method]) => method === "cw_decode_track_mute")).toBe(true));
    expect(owner.request.mock.calls.find(([method]) => method === "cw_decode_track_mute")![1]).toEqual({ reference: track.controlReference });
  });
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
  it("requires an explicit current DAX handoff without acquiring on mount", async () => {
    const fixture = cwDecodeFixture(); fixture.configuration.sources[0] = { ...fixture.configuration.sources[0], provider: "flex_dax_iq", receiverID: "40000000" };
    fixture.capabilities = [{ radioID: "radio1", provider: "flex_dax_iq", ready: true, receivers: [], requestableSampleRates: [96000],
      inventoryRevision: "7", stationHandle: 0x1234, transmitStateKnownOff: true, handoffPanadapters: [],
      panadapters: [{ id: "40000000", channel: 1, clientHandle: 0x1234, centreHz: 14025000, receiveAntenna: "ANT1" }] }];
    const owner = service(fixture); render(<CWDecodePanel request={owner.request} />);
    const button = await screen.findByRole("button", { name: "Allow xLog to acquire DAX IQ 1" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(owner.request.mock.calls.every(([method]) => method === "cw_decode_snapshot")).toBe(true);
    fireEvent.click(screen.getByLabelText("I released DAX IQ 1 in other apps for this Station."));
    fireEvent.click(button);
    await waitFor(() => expect(owner.request.mock.calls.some(([method]) => method === "cw_decode_flex_handoff")).toBe(true));
    expect(owner.request.mock.calls.find(([method]) => method === "cw_decode_flex_handoff")![1]).toEqual({ expected_revision: fixture.configuration.revision,
      radio_id: "radio1", panadapter_id: "40000000", inventory_revision: "7" });
    expect(owner.request.mock.calls.some(([method]) => method === "cw_decode_start")).toBe(false);
  });
  it("labels observed signal estimates and the SNR reference bandwidth", async () => {
    const fixture = cwDecodeTrackFixture(); Object.assign(fixture.tracks[0], { estimatedWPM: 24.5, estimatedSNRDB: 12, snrReferenceHz: 2500 });
    render(<CWDecodePanel request={service(fixture).request} />);
    await screen.findByText("24.5"); expect(screen.getByText("12.0 dB")).toBeTruthy();
    expect(screen.getByTitle(/2.5 kHz noise bandwidth/)).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Est. WPM" })).toBeTruthy();
  });
  it("keeps all capture and listener acquisition disabled in a gated build", async () => {
    const fixture = cwDecodeFixture(); fixture.featureEnabled = false; fixture.configuration.listenerEnabled = true;
    const owner = service(fixture); render(<CWDecodePanel request={owner.request} />);
    await screen.findByText("CW Decode is disabled in this build while input and release qualification are incomplete.");
    expect((screen.getByRole("button", { name: "Start decoding" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Start server" }) as HTMLButtonElement).disabled).toBe(true);
    expect(owner.request.mock.calls.every(([method]) => method === "cw_decode_snapshot")).toBe(true);
  });
});
