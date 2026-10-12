// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CWSettings from "./CWSettings";
import CWDesk from "./CWDesk";
import { CWController } from "./cwController";
import { defaultCWProfile, type CWProfile } from "./cwMacros";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("backend-specific preview limits (no transmission)", () => {
  it.each([
    ["hamlib", "radio", 80, true], ["hamlib", "radio", 81, false],
    ["direct_agent", "radio", 81, true], ["direct_agent", "radio", 128, true], ["direct_agent", "radio", 129, false],
    ["direct_flex_lan", "radio", 128, true], ["direct_flex_lan", "radio", 129, false],
    ["hamlib", "winkeyer", 128, true], ["hamlib", "winkeyer", 129, false],
  ] as const)("%s/%s shows %i characters consistently (allowed: %s)", (provider, output, length, allowed) => {
    vi.stubGlobal("ResizeObserver", class { constructor(private callback: (entries: any[]) => void) {} observe() { this.callback([{ contentRect: { width: 1800 } }]); } disconnect() {} });
    const request = vi.fn(async () => ({}));
    const controller = new CWController(request);
    const profile: CWProfile = { ...defaultCWProfile, output, showOnDesk: true, macros: [{ ...defaultCWProfile.macros[0], text: "C".repeat(length) }] };
    render(<><CWSettings value={profile} onChange={vi.fn()} radioProvider={provider} />
      <CWDesk profile={profile} context={{}} controller={controller} state={controller.getSnapshot()} radioProvider={provider} /></>);
    const preview = screen.getByLabelText("Expanded CW preview").textContent;
    const tooltip = screen.getByRole("button", { name: "CQ" }).title;
    if (allowed) { expect(preview).toBe("C".repeat(length)); expect(tooltip).toBe(`CQ: ${preview}`); }
    else { expect(preview).toMatch(/this output allows/); expect(tooltip).toBe(`CQ: ${preview}`); }
    expect(request).not.toHaveBeenCalled();
  });
});
