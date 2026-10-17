// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import RotorCompass, { bearingArc, bearingDelta } from "./RotorCompass";
afterEach(cleanup);
describe("telemetry compass", () => {
  it("uses the short rotation across north without a reverse full-circle sweep", () => {
    expect(bearingDelta(359, 1)).toBe(2); expect(bearingDelta(1, 359)).toBe(-2);
    expect(bearingDelta(721, 359)).toBe(-2); expect(bearingArc(40, 40)).toBe("");
  });
  it("shows one actual needle, a rim target and hides actual bearing when offline", () => {
    const view = render(<RotorCompass connected azimuth={359} target={42} path="SP" />);
    expect(screen.getByLabelText("Observed rotor bearing 359 degrees")).toBeTruthy();
    expect(view.container.querySelectorAll(".rotor-observed-needle")).toHaveLength(1);
    expect(screen.getByLabelText("SP target bearing 42 degrees")).toBeTruthy();
    view.rerender(<RotorCompass connected={false} azimuth={359} target={42} path="SP" />);
    expect(screen.getByLabelText("Rotor bearing unavailable")).toBeTruthy();
    expect(view.container.querySelector(".rotor-observed-needle")).toBeNull();
    expect(view.container.querySelector(".rotor-target-arc")).toBeNull();
  });
  it("adds optional in-dial readouts without covering them with the center needle", () => {
    const view = render(<RotorCompass connected azimuth={53} target={73} path="SP" readout={{ call: "W7AIT", distanceKm: 12500, status: "Ready" }} />);
    expect(screen.getByText("053°")).toBeTruthy();
    expect(screen.getByText("SP 73° TARGET")).toBeTruthy();
    expect(screen.getByText("12,500 km")).toBeTruthy();
    expect(view.container.querySelector("desc")?.textContent).toContain("Target callsign W7AIT. SP target 73 degrees. SP distance 12,500 km. Ready.");
    expect(view.container.querySelector(".rotor-dial-hub")).toBeNull();
    view.rerender(<RotorCompass connected={false} azimuth={53} target={73} path="LP" readout={{ call: "", distanceKm: undefined }} />);
    expect(screen.getByText("NO TELEMETRY")).toBeTruthy();
    expect(screen.getByText("---°")).toBeTruthy();
    expect(screen.queryByText("Distance unavailable")).toBeNull();
    expect(view.container.querySelector(".rotor-observed-needle")).toBeNull();
    expect(view.container.querySelector(".rotor-target-arc")).toBeNull();
  });
  it("keeps optional path controls outside the circular dial at opposite shell corners", () => {
    const selected: Array<"SP" | "LP"> = [];
    const view = render(<RotorCompass connected azimuth={53} target={73} path="SP" readout={{ call: "W7AIT" }}
      pathControls={{ shortBearing: 73, longBearing: 253, onSelect: path => selected.push(path) }} />);
    const dial = view.container.querySelector(".rotor-dial-shell > .rotor-dial"), controls = view.container.querySelector(".rotor-path-controls")!;
    const shortPath = screen.getByRole("button", { name: "Turn rotor short path" }), longPath = screen.getByRole("button", { name: "Turn rotor long path" });
    expect(dial).toBeTruthy();
    expect(controls.parentElement).toBe(dial?.parentElement);
    expect(dial?.contains(shortPath)).toBe(false);
    expect(controls.firstElementChild).toBe(shortPath);
    expect(controls.lastElementChild).toBe(longPath);
    longPath.click();
    expect(selected).toEqual(["LP"]);
  });
});
