// @vitest-environment jsdom
import { createElement, useRef } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logbookCapacity, useLogbookCapacity } from "./logbookCapacity";
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("available logbook row capacity", () => {
  it("fits actual row and header heights with a rounding guard", () => {
    expect(logbookCapacity(320, 35, 28)).toBe(10);
    expect(logbookCapacity(322, 35, 28)).toBe(10);
    expect(logbookCapacity(680, 35, 28)).toBe(22);
    expect(logbookCapacity(680, 48, 40)).toBe(15);
  });
  it("bounds data requests and retains a non-layout fallback", () => {
    expect(logbookCapacity(30, 35, 28)).toBe(1);
    expect(logbookCapacity(50000, 35, 28)).toBe(100);
    expect(logbookCapacity(0, 0, 0)).toBe(100);
    expect(logbookCapacity(500, 35, NaN)).toBe(100);
  });
  it("fills the same layout at 125%, 150% and 200% UI zoom", () => {
    for (const zoom of [1.25, 1.5, 2]) {
      expect(logbookCapacity(680, 35 * zoom, 28 * zoom, zoom)).toBe(22);
      expect(logbookCapacity(320, 35 * zoom, 28 * zoom, zoom)).toBe(10);
    }
    expect(logbookCapacity(680, 35, 28, 0)).toBe(100);
  });
  it("does not multiply the first row's collapsed header border into every row", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(458);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const height = this.tagName === "THEAD" ? 34.5 : this.tagName === "TR" && this.previousElementSibling ? 28 : 28.5;
      return { height } as DOMRect;
    });
    function Table() {
      const ref = useRef<HTMLDivElement>(null);
      const capacity = useLogbookCapacity(ref, 2);
      return createElement("div", { ref }, createElement("output", null, capacity), createElement("table", null,
        createElement("thead", null, createElement("tr", null, createElement("th", null, "UTC"))),
        createElement("tbody", null, ...["A", "B"].map(call => createElement("tr", { key: call }, createElement("td", null, call))))));
    }
    render(createElement(Table));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("15"));
    expect(logbookCapacity(458, 34.5, 28.5)).toBe(14);
  });
});
