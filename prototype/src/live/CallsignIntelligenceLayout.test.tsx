// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DeskIntelligence } from "./CallsignIntelligence";

afterEach(cleanup);
const allBands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm"];
function card(intelligenceBands?: string[]) {
  return render(<DeskIntelligence draft={{ call: "OM0RX" }} lookup={{ call: "OM0RX", dxcc: 504, gridSquare: "JN88AA00AA", continent: "EU", cqZone: 15, ituZone: 28, distance_km: 19999 }}
    previous={[]} request={vi.fn(async () => new Promise(() => {}))} refresh={0} intelligenceBands={intelligenceBands} />);
}

it("balances default and complete band selections into two rows at a wide panel width", () => {
  const { unmount } = card();
  for (const scope of ["Callsign", "DXCC"]) {
    const matrix = screen.getByLabelText(`${scope} band status`);
    expect(matrix.children).toHaveLength(10);
    expect(matrix.style.getPropertyValue("--desk-matrix-columns")).toBe("5");
    expect(matrix.style.getPropertyValue("--desk-matrix-wide-columns")).toBe("5");
  }
  unmount(); card(allBands);
  for (const scope of ["Callsign", "DXCC"]) {
    const matrix = screen.getByLabelText(`${scope} band status`);
    expect(matrix.children).toHaveLength(14);
    expect(matrix.style.getPropertyValue("--desk-matrix-columns")).toBe("5");
    expect(matrix.style.getPropertyValue("--desk-matrix-wide-columns")).toBe("7");
    expect(screen.getByLabelText(`${scope} 70cm: Unknown`)).toBeTruthy();
  }
});

it("sizes from unique supported bands and preserves full fact values for truncation tooltips", () => {
  const { container } = card(["20m", "20m", "40m", "unsupported"]);
  const matrix = screen.getByLabelText("Callsign band status");
  expect(matrix.children).toHaveLength(2);
  expect(matrix.style.getPropertyValue("--desk-matrix-wide-columns")).toBe("1");
  const facts = container.querySelectorAll(".desk-identity-facts > div");
  expect(Array.from(facts, fact => fact.querySelector("dt")?.textContent)).toEqual(["DXCC", "GRID", "CONT", "ZONES", "DISTANCE"]);
  for (const fact of facts) {
    const value = fact.querySelector("dd")!;
    expect(value.title).toBe(value.textContent);
  }
  expect(screen.getByTitle("JN88AA00AA")).toBeTruthy();
  expect(screen.getByTitle("CQ 15 · ITU 28")).toBeTruthy();
});
