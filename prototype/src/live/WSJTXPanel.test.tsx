// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WSJTXPanel, { validWSJTXConfiguration } from "./WSJTXPanel";

const snapshot = (patch: Record<string, unknown> = {}) => ({
  configuration: { enabled: false, address: "127.0.0.1", port: 2237 }, running: false,
  received_count: 0, imported_count: 0, duplicate_count: 0, ignored_count: 0,
  rejected_count: 0, dropped_count: 0, status: "Off", receive_only: true, ...patch,
});

describe("WSJT-X receive-only logging", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  it("accepts loopback and multicast but rejects widened unicast", () => {
    expect(validWSJTXConfiguration({ enabled: true, address: "127.0.0.1", port: 2237 })).toBe(true);
    expect(validWSJTXConfiguration({ enabled: true, address: "239.255.0.1", port: 2237 })).toBe(true);
    expect(validWSJTXConfiguration({ enabled: true, address: "192.168.1.5", port: 2237 })).toBe(false);
    expect(validWSJTXConfiguration({ enabled: true, address: "239.1.1.1", port: 0 })).toBe(false);
  });

  it("saves before starting and explains the receive-only boundary", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, any>) => method === "wsjtx_configure"
      ? snapshot({ configuration: params!.configuration }) : method === "wsjtx_start" ? snapshot({ running: true,
        configuration: { enabled: true, address: "127.0.0.1", port: 2237 } }) : snapshot());
    render(<WSJTXPanel request={request} />);
    expect(await screen.findByText(/never sends WSJT-X packets/i)).toBeTruthy();
    expect(screen.getByText(/It is not a CAT server/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save and listen" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("wsjtx_start"));
    expect(request.mock.calls.map(([method]) => method).slice(0, 3)).toEqual(["wsjtx_snapshot", "wsjtx_configure", "wsjtx_start"]);
    const configured = request.mock.calls.find(([method]) => method === "wsjtx_configure");
    expect(configured?.[1]?.configuration.enabled).toBe(true);
  });

  it("does not start after a rejected configuration save", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "wsjtx_configure") throw new Error("Port unavailable");
      return snapshot();
    });
    render(<WSJTXPanel request={request} />); await screen.findByLabelText("WSJT-X UDP address");
    fireEvent.click(screen.getByRole("button", { name: "Save and listen" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Port unavailable");
    expect(request).not.toHaveBeenCalledWith("wsjtx_start");
  });

  it("can disable an enabled listener after a bind failure left it stopped", async () => {
    const enabled = snapshot({ configuration: { enabled: true, address: "127.0.0.1", port: 2237 }, status: "Could not start" });
    const request = vi.fn(async (method: string) => method === "wsjtx_stop" ? snapshot() : enabled);
    render(<WSJTXPanel request={request} />);
    const stop = await screen.findByRole("button", { name: "Stop listening" });
    expect((stop as HTMLButtonElement).disabled).toBe(false); fireEvent.click(stop);
    await waitFor(() => expect(request).toHaveBeenCalledWith("wsjtx_stop"));
  });

  it("reports a newly observed import to the parent", async () => {
    let reads = 0;
    const onImported = vi.fn();
    const request = vi.fn(async () => snapshot({ imported_count: reads++ === 0 ? 0 : 1 }));
    vi.useFakeTimers();
    render(<WSJTXPanel request={request} onImported={onImported} />);
    await vi.advanceTimersByTimeAsync(2100);
    expect(onImported).toHaveBeenCalledTimes(1);
  });
  it("displays bounded CQ activity without saving a contact or enabling a listener", async () => {
    const request = vi.fn(async () => snapshot({ activity:{ spots:[{}, {}], session_count:2 } }));
    const imported = vi.fn(); render(<WSJTXPanel request={request} onImported={imported} />);
    expect(await screen.findByText("Retained CQ reports: 2 · WSJT-X instances: 2")).toBeTruthy();
    expect(screen.getByText(/Existing rules remain DX Cluster only/)).toBeTruthy();
    expect(imported).not.toHaveBeenCalled();
    expect(request.mock.calls).toEqual([["wsjtx_snapshot"]]);
  });
});
