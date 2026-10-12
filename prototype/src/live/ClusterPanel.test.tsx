// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ClusterPanel } from "./ClusterPanel";

afterEach(cleanup);
const palette = ["bands", "modes", "continents", "callStatuses", "dxccStatuses", "specials", "sources", "worked", "sort"];
const luminance = (hex: string) => {
  const values = hex.match(/\w\w/g)!.map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
};

describe("DX Cluster filter colours", () => {
  it("assigns a stable category colour without changing filter labels or actions", async () => {
    const request = vi.fn(async (_method: string, _params?: Record<string, unknown>) => ({}));
    render(<ClusterPanel snapshot={null} onRequest={request} onSelect={vi.fn()} />);
    await waitFor(() => expect(request).toHaveBeenCalledWith("cluster_snapshot", {}));
    const rail = screen.getByLabelText("Spot filters");
    expect(Array.from(rail.querySelectorAll("[data-filter]")).map(node => node.getAttribute("data-filter"))).toEqual(palette);
    const bands = within(rail).getByRole("button", { name: "Bands" });
    fireEvent.click(bands);
    expect(bands.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(screen.getByRole("group", { name: "Bands" })).getByRole("checkbox", { name: "20m" }));
    expect(request).toHaveBeenLastCalledWith("cluster_filter", { filter: expect.objectContaining({ bands: ["20m"] }) });
    fireEvent.change(screen.getByRole("combobox", { name: "Sort spots" }), { target: { value: "frequency" } });
    expect(request).toHaveBeenLastCalledWith("cluster_filter", { filter: expect.objectContaining({ bands: ["20m"], sort: "frequency" }) });
    fireEvent.click(within(rail).getByRole("button", { name: "Clear filters" }));
    expect(request).toHaveBeenLastCalledWith("cluster_filter", { filter: expect.objectContaining({ bands: [], sort: "newest" }) });
    expect(request.mock.calls.some(([method]) => /connect|select|tune/.test(method))).toBe(false);
  });

  it("keeps every category label above AA contrast on its own tinted surface", () => {
    const css = readFileSync("src/live/ClusterPanel.css", "utf8");
    for (const category of palette) {
      const match = css.match(new RegExp(`\\[data-filter="${category}"\\] \\{ --filter-ink: #([0-9a-f]{6}); --filter-surface: #([0-9a-f]{6});`));
      expect(match, category).not.toBeNull();
      const foreground = luminance(match![1]);
      const background = luminance(match![2]);
      expect((foreground + 0.05) / (background + 0.05), category).toBeGreaterThanOrEqual(4.5);
    }
  });
});
