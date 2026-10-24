import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./DXpeditionMap.css", import.meta.url), "utf8");

describe("DXpedition Map responsive presentation", () => {
  it("owns the detached window width instead of inheriting the live sidebar grid", () => {
    expect(css).toContain(".app.live.dxp-app { display:block; grid-template:none; width:100%");
    expect(css).toContain(".app.live.dxp-app>main{overflow:auto;height:100dvh;min-height:100dvh}");
  });

  it("keeps source health and controls visible at narrow widths", () => {
    expect(css).toContain(".dxp-source-strip{scrollbar-width:thin}");
    expect(css).not.toMatch(/\.dxp-source-strip\s*\{[^}]*display\s*:\s*none/);
    expect(css).toContain(".dxp-close{width:44px;height:44px}");
  });

  it("uses solid operating surfaces and visible keyboard focus", () => {
    expect(css).not.toContain("linear-gradient");
    expect(css).not.toContain("backdrop-filter");
    expect(css).toContain(":is(button,input,a):focus-visible { outline:2px solid var(--dxp-cyan)");
  });
});
