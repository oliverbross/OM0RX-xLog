import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./ContestWorkspace.css", import.meta.url), "utf8");

describe("ContestWorkspace responsive contract", () => {
  it("reflows manager and operating regions before the compact contact-row layout", () => {
    expect(css).toContain("@container contest-workspace (max-width:900px)");
    expect(css).toContain(".contest-manager,.contest-operating-grid { grid-template-columns:minmax(0,1fr); }");
    expect(css).toContain("@container contest-workspace (max-width:560px)");
    expect(css).toContain(".contest-log td::before { content:attr(data-label)");
  });

  it("retains visible keyboard focus and bounded overflow for long contest values", () => {
    expect(css).toContain("outline:2px solid var(--cyan,#35c8f5)");
    expect(css).toContain("overflow-wrap:anywhere");
    expect(css).toContain("min-width:0");
  });
});
