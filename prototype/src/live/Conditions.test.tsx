// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import Conditions from "./Conditions";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("stable propagation presentation", () => {
  it("keeps graphical last-known bands through a missing refresh without issuing requests", () => {
    const request = vi.fn();
    const propagation = { bands: [{ name: "20m", day: "Good", night: "Fair" }], solar_flux: 122, updated_at: 1_800_000_000, source: "N0NBH / HamQSL" };
    const { rerender, container } = render(<Conditions propagation={propagation} request={request} weatherKey="" />);
    const band = screen.getByLabelText("Day: Good");
    expect(band.tagName).toBe("I");
    rerender(<Conditions propagation={null} request={request} weatherKey="" />);
    expect(screen.getByLabelText("Day: Good")).toBe(band);
    expect(screen.getByText(/last known/)).toBeTruthy();
    expect(container.querySelectorAll(".condition-source > span")).toHaveLength(2);
    expect(request).not.toHaveBeenCalled();
  });

  it("does not fabricate band conditions while no observation exists", () => {
    render(<Conditions propagation={null} request={vi.fn()} weatherKey="" />);
    expect(screen.getAllByLabelText("Day: Unknown")).toHaveLength(4);
    expect(screen.getByText("Awaiting propagation data")).toBeTruthy();
    expect(screen.queryByLabelText("Day: Good")).toBeNull();
  });

  it("refreshes weather independently and keeps the last observation on failure", async () => {
    const request = vi.fn().mockResolvedValueOnce({ temperature_c: 21, condition: "Clear", wind_kmh: 4, observed_at: 1_800_000_000, source: "Open-Meteo" })
      .mockRejectedValueOnce(new Error("Weather service unavailable"));
    render(<Conditions propagation={null} request={request} weatherKey="JN88TQ" />);
    await screen.findByText("21°C · Clear · 4 km/h");
    fireEvent.click(screen.getByRole("button", { name: "Refresh weather" }));
    await screen.findByText(/last known/);
    expect(screen.getByText("21°C · Clear · 4 km/h")).toBeTruthy();
    expect(screen.getByText("Weather service unavailable")).toBeTruthy();
    expect(request.mock.calls).toEqual([["weather"], ["weather"]]);
  });

  it("discards old-grid results and retires automatic refresh on unmount", async () => {
    vi.useFakeTimers();
    let resolveOld!: (value: unknown) => void;
    const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
      .mockResolvedValue({ temperature_c: 30, condition: "Clear", wind_kmh: 2, source: "Open-Meteo" });
    const { rerender, unmount } = render(<Conditions propagation={null} request={request} weatherKey="JN88TQ" />);
    rerender(<Conditions propagation={null} request={request} weatherKey="PH57" />);
    await act(async () => { resolveOld({ temperature_c: -5, condition: "Snow", wind_kmh: 8 }); });
    expect(screen.queryByText(/Snow/)).toBeNull();
    expect(screen.getByText("30°C · Clear · 2 km/h")).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
    expect(request).toHaveBeenCalledTimes(3);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(15 * 60_000); });
    expect(request).toHaveBeenCalledTimes(3);
  });
});
