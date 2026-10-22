import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const setup = readFileSync(new URL("./DetachedContestSetupDialog.css", import.meta.url), "utf8");
const digital = readFileSync(new URL("./DetachedContestDigitalDialog.css", import.meta.url), "utf8");
const operator = readFileSync(new URL("./ContestOperatorDialog.css", import.meta.url), "utf8");
const auxiliary = readFileSync(new URL("./DetachedContestAuxiliaryDialog.css", import.meta.url), "utf8");

describe("contest tool window content-fit contract", () => {
  it("uses the viewport as the dialog shell and confines setup overflow to its fieldset", () => {
    expect(setup).toContain(".contest-setup-dialog { height:100dvh; min-height:0; overflow:hidden;");
    expect(setup).toContain(".contest-setup-dialog .contest-setup>header { display:none; }");
    expect(setup).toContain(".contest-setup-dialog .contest-setup fieldset { flex:1; min-height:0; overflow:auto; }");
    expect(setup).toContain(".contest-setup-dialog[data-dialog-kind=station] .contest-station-form { gap:4px; }");
    expect(setup).toContain(".contest-setup-dialog[data-dialog-kind=keys] .contest-setup fieldset { overflow:hidden; }");
    expect(setup).toContain(".contest-setup-dialog[data-dialog-kind=keys] .contest-key-scroll { flex:1; min-height:0; }");
    expect(setup).toContain("@media(max-width:700px)");
  });

  it("lets the content-rich Digital dialog scroll as one surface at constrained sizes", () => {
    expect(digital).toContain("width:100%; height:100dvh; min-width:0; min-height:0;");
    expect(digital).toContain("grid-template-columns:minmax(0,1fr)");
    expect(digital).toContain("overflow:auto");
    expect(digital).toContain(".contest-digital-dialog footer { align-items:stretch; flex-direction:column; }");
  });

  it("keeps compact tools usable when native geometry is clamped", () => {
    expect(operator).toContain("height:100dvh; min-height:0;");
    expect(operator).toContain("overflow:auto");
    expect(auxiliary).toContain("width:100%; height:100dvh; min-width:0; min-height:0;");
    expect(auxiliary).toContain(".contest-rover-dialog { display:grid; align-content:center; overflow:auto; }");
    expect(auxiliary).toContain("@media (max-width:360px) { .contest-rover-dialog { align-content:start; }");
    expect(auxiliary).toContain(".contest-about-scroll { flex:1; min-height:0; overflow:auto;");
  });
});
