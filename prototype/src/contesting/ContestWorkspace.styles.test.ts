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
    expect(detachedCSS).toContain("grid-template-columns:repeat(4,minmax(0,1fr))");
    expect(detachedCSS).toContain("grid-template-columns:repeat(2,minmax(0,1fr))");
    expect(detachedCSS).toContain(".contest-field-label");
    expect(detachedCSS).toContain(".contest-detached-surface button { font:inherit; white-space:nowrap; }");
    expect(setupDialogCSS).toContain("text-overflow:ellipsis; white-space:nowrap");
    expect(css).toContain(".contest-history-window { width:100%; height:100dvh; min-height:0; overflow:auto; }");
  });

  it("contains detached table and candidate overflow without an outer horizontal scrollbar", () => {
    expect(detachedCSS).toContain("overflow-x:hidden; overflow-y:auto");
    expect(detachedCSS).toContain(".contest-surface-row > * { flex:1 1 120px; min-width:0; }");
    expect(detachedCSS).toContain(".contest-surface-logging-body { display:flex; flex:0 0 auto; min-width:0; min-height:0;");
    expect(detachedCSS).toContain(".contest-surface-check-columns { display:grid; flex:1 1 0;");
    expect(detachedCSS).toContain("min-height:0; overflow-x:hidden; overflow-y:auto; border-right:1px solid var(--border)");
    expect(detachedCSS).toContain("display:grid; flex:1 1 0; grid-template-columns:minmax(0,1fr);");
    expect(detachedCSS).toContain(".contest-surface-check-columns button { width:100%; min-width:0; overflow:hidden; text-overflow:ellipsis;");
    expect(detachedCSS).toContain(".contest-surface-log-scroll { flex:1; min-width:0; max-width:100%; min-height:0; overflow:hidden;");
  });

  it("reflows a resizable Check Partial window into two and three useful panes", () => {
    expect(detachedCSS).toContain("@container contest-detached (min-width:480px)");
    expect(detachedCSS).toContain(".contest-surface-check-columns { grid-template-columns:repeat(2,minmax(0,1fr)); }");
    expect(detachedCSS).toContain("@container contest-detached (min-width:760px)");
    expect(detachedCSS).toContain(".contest-surface-check-columns { grid-template-columns:repeat(3,minmax(0,1fr)); }");
    expect(detachedCSS).toContain('.contest-surface-check-columns[data-pane-count="2"] { grid-template-columns:repeat(2,minmax(0,1fr)); }');
    expect(detachedCSS).toContain('.contest-surface-check-columns[data-pane-count="2"] .contest-surface-results { grid-template-columns:repeat(2,minmax(0,1fr)); }');
    expect(detachedCSS).toContain("@container contest-detached (min-width:1080px)");
    expect(detachedCSS).toContain('grid-template-columns:repeat(3,minmax(0,1fr));');
    expect(detachedCSS).toContain(".contest-surface-check-columns > div:nth-child(4) { grid-column:1 / -1; }");
  });

  it("stacks narrow multiplier controls and lets wide country blocks use the full window", () => {
    expect(detachedCSS).toContain(".contest-surface-matrix-summary { display:flex; flex-wrap:wrap;");
    expect(detachedCSS).toContain(".contest-surface-matrix-summary > span { white-space:nowrap; }");
    expect(detachedCSS).toContain(".contest-surface-matrix-blocks { display:grid; align-items:start; gap:8px; width:100%; min-width:max-content;");
    expect(detachedCSS).toContain(".contest-surface-matrix-scroll table { width:100%; min-width:max-content;");
    expect(detachedCSS).toContain(".contest-surface-matrix-toolbar { display:grid; grid-template-columns:minmax(0,1fr);");
    expect(detachedCSS).toContain(".contest-surface-matrix-toolbar label { display:grid; grid-template-columns:auto minmax(0,1fr); }");
    expect(detachedCSS).toContain(".contest-surface-matrix-summary { display:grid; grid-template-columns:minmax(0,1fr); gap:1px; }");
  });

  it("keeps the original contest windows compact while log rows fit and page without scrolling", () => {
    expect(detachedCSS).toContain("> main:has(> :is(.contest-surface-entry,.contest-surface-check,.contest-surface-statistics,.contest-surface-rates,.contest-surface-log)) { overflow:hidden; }");
    expect(detachedCSS).toContain(".contest-surface-check-columns > div { display:flex; flex-direction:column; min-width:0; min-height:0; overflow-x:hidden; overflow-y:auto;");
    expect(detachedCSS).toContain(".contest-surface-statistics-scroll { flex:1; width:100%; min-width:0; min-height:0; overflow:auto;");
    expect(detachedCSS).toContain(".contest-surface-log-panes { overflow:hidden; }");
    expect(detachedCSS).toContain(".contest-surface-log-scroll { flex:1; min-width:0; max-width:100%; min-height:0; overflow:hidden;");
    expect(detachedCSS).toContain("grid-template-rows:minmax(112px,2fr) minmax(76px,1fr)");
    expect(detachedCSS).toContain(".contest-surface-log-tools { position:relative;");
  });

  it("aligns the Main Logging title bar and Rates values without changing the operator strips", () => {
    expect(detachedCSS).toContain("grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)");
    expect(detachedCSS).toContain(".contest-surface-entry > header h1 { min-width:0; justify-self:end; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }");
    expect(detachedCSS).toContain(".contest-surface-rates dl > div,.contest-surface-rates tr { display:grid; grid-template-columns:minmax(0,1fr) 96px;");
    expect(detachedCSS).toContain(".contest-surface-run-strip > * + * { margin-inline-start:14px; }");
    expect(detachedCSS).toContain(".contest-surface-band-ladder { display:flex; flex:0 0 42px;");
  });

  it("uses one compact label-width token for detached Contest Setup fields", () => {
    expect(setupCSS).toContain("--contest-setup-label-width:100px");
    expect(setupCSS).toContain("flex:0 0 var(--contest-setup-label-width)");
    expect(setupCSS).toContain("text-overflow:ellipsis; white-space:nowrap");
    expect(setupCSS).not.toMatch(/flex-basis:\s*(?:65|90)px/);
  });

  it("fits Edit Keys into the initial Contest Setup width while retaining intentional macro scrolling", () => {
    expect(setupCSS).toContain(".contest-key-table { table-layout:fixed; }");
    expect(setupCSS).toContain(".contest-macro-table { min-width:650px; }");
    expect(setupCSS).toContain(".contest-binding-table { min-width:0; }");
    expect(setupCSS).toContain(".contest-binding-table :is(th,td,output) { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }");
    expect(setupCSS).not.toMatch(/\.contest-key-table\s*\{[^}]*min-width:650px/);
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
