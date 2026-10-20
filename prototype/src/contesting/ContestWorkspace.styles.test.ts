import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./ContestWorkspace.css", import.meta.url), "utf8");
const detachedCSS = readFileSync(new URL("./DetachedContestSurface.css", import.meta.url), "utf8");
const setupCSS = readFileSync(new URL("./ContestSetupPanel.css", import.meta.url), "utf8");
const setupDialogCSS = readFileSync(new URL("./DetachedContestSetupDialog.css", import.meta.url), "utf8");
const entrypoint = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");

describe("ContestWorkspace responsive contract", () => {
  it("reflows manager and operating regions before the compact contact-row layout", () => {
    expect(css).toContain("@container contest-workspace (max-width:900px)");
    expect(css).toContain(".contest-manager,.contest-operating-grid { grid-template-columns:minmax(0,1fr); }");
    expect(css).toContain("@container contest-workspace (max-width:560px)");
    expect(css).toContain(".contest-log td::before { content:attr(data-label)");
  });

  it("retains visible keyboard focus and bounded overflow for long contest values", () => {
    expect(css).toContain(".contest-workspace { box-sizing:border-box;");
    expect(css).toContain("outline:2px solid var(--cyan,#35c8f5)");
    expect(css).toContain("overflow-wrap:anywhere");
    expect(css).toContain("min-width:0");
  });

  it("keeps detached contest controls dense and reflows them at scaled narrow widths", () => {
    expect(detachedCSS).toContain(".contest-detached-surface,.contest-detached-surface * { box-sizing:border-box; }");
    expect(detachedCSS).toContain("grid-template-columns:var(--contest-entry-field-columns)");
    expect(detachedCSS).toContain("grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(detachedCSS).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(detachedCSS).toContain(".contest-field-label");
    expect(detachedCSS).toContain(".contest-detached-surface button { font:inherit; white-space:nowrap; }");
    expect(setupDialogCSS).toContain("text-overflow:ellipsis; white-space:nowrap");
    expect(css).toContain(".contest-history-window { width:100%; height:100dvh; min-height:0; overflow:auto; }");
  });

  it("uses one compact label-width token for detached Contest Setup fields", () => {
    expect(setupCSS).toContain("--contest-setup-label-width:100px");
    expect(setupCSS).toContain("flex:0 0 var(--contest-setup-label-width)");
    expect(setupCSS).toContain("text-overflow:ellipsis; white-space:nowrap");
    expect(setupCSS).not.toMatch(/flex-basis:\s*(?:65|90)px/);
  });

  it("keeps the original compact horizontal New Contest form without vertical auto spacing", () => {
    expect(setupCSS).toContain(".contest-workspace .contest-setup label { display:flex; flex-direction:row;");
    expect(setupCSS).toContain(".contest-parameters { display:flex; flex-direction:column; gap:4px; max-width:470px; margin:0 auto;");
    expect(setupCSS).toContain('[data-setup-view="New Contest"]');
    expect(setupCSS).toContain(".contest-manual-content { gap:0; min-height:0; }");
    expect(setupCSS).toContain("textarea { height:46px; min-height:46px; resize:none; }");
  });

  it("mounts every main or detached surface inside the shared interface scale provider", () => {
    expect(entrypoint).toContain("<UiScaleProvider><App /></UiScaleProvider>");
  });
});
