// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import AgentConfiguration from "./AgentConfiguration";

const bands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"];
const map = (value: number | string) => Object.fromEntries(bands.map((band) => [band, value]));
const fixture = () => ({
  schema_version: 1, extension: { keep: "untouched" },
  flex: { model: "FLEX-8400", host: "192.0.2.15", port: 4992, slice_id: 0, station_name: "Maestro", extra: 4 },
  kpa500: { enabled: true, port: "COM17", baudrate: 38400 },
  kat500: { enabled: true, port: "COM15", baudrate: 38400 }, commissioned: false,
  policy: {
    follow_radio: true, digital_kpa_policy: "operate", flex_antenna: { enabled: true, bands: map("ANT1") },
    kat_antenna: map(1), kat_antenna_names: { "1": "KAT ANT1", "2": "KAT ANT2", "3": "KAT ANT3" },
    amplifier_allowed_bands: [], amplifier_drive_w: map(25), barefoot_drive_w: map(25),
    digital_amplifier_allowed_bands: [], digital_amplifier_drive_w: map(25),
    tune_power_w: 25, tune_target_swr: 1.5, tune_abort_swr: 3, tune_timeout_seconds: 30,
    extension: "keep this too",
  },
});
afterEach(cleanup);

describe("AgentConfiguration", () => {
  it("requires explicit review before save and preserves unknown fields", async () => {
    const config = fixture(); const onSave = vi.fn(async (_next: Record<string, unknown>) => undefined);
    render(<AgentConfiguration config={config} onSave={onSave} />);
    expect(screen.queryByRole("button", { name: "Save reviewed configuration" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Maestro station"), { target: { value: "Contest Maestro" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    const review = screen.getByRole("region", { name: "Configuration change review" });
    expect(within(review).getByText("Maestro")).toBeTruthy();
    expect(within(review).getByText("Contest Maestro")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save reviewed configuration" }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave.mock.calls[0][0]).toMatchObject({ extension: { keep: "untouched" }, flex: { station_name: "Contest Maestro", extra: 4 }, policy: { extension: "keep this too" } });
    expect(config.flex.station_name).toBe("Maestro");
  });

  it("blocks invalid tune and per-band drive values", () => {
    const onSave = vi.fn(async () => undefined);
    render(<AgentConfiguration config={fixture()} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("Abort SWR"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("20m Digital W"), { target: { value: "101" } });
    expect(screen.getByRole("alert").textContent).toContain("Abort SWR must exceed target SWR");
    expect(screen.getByRole("button", { name: "Review changes" }).hasAttribute("disabled")).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("edits per-band routing, allowances and digital drive with a scoped diff", () => {
    render(<AgentConfiguration config={fixture()} onSave={vi.fn(async () => undefined)} />);
    fireEvent.change(screen.getByLabelText("20m FLEX TX antenna"), { target: { value: "ANT2" } });
    fireEvent.change(screen.getByLabelText("20m KAT output"), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("20m amplifier allowed"));
    fireEvent.click(screen.getByLabelText("20m digital amplifier allowed"));
    fireEvent.change(screen.getByLabelText("20m Digital W"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    const review = screen.getByRole("region", { name: "Configuration change review" });
    expect(within(review).getByText("20m FLEX TX")).toBeTruthy();
    expect(within(review).getByText("20m KAT out")).toBeTruthy();
    expect(within(review).getByText("20m Digital W")).toBeTruthy();
    expect(review.textContent).not.toContain("control_token");
  });

  it("prevents commissioning with disabled required hardware", () => {
    render(<AgentConfiguration config={fixture()} onSave={vi.fn(async () => undefined)} />);
    fireEvent.click(screen.getByLabelText("KPA500 enabled"));
    fireEvent.click(screen.getByLabelText("Commissioned"));
    expect(screen.getByRole("alert").textContent).toContain("commissioned profile requires both accessories");
    expect(screen.getByRole("button", { name: "Review changes" }).hasAttribute("disabled")).toBe(true);
  });

  it("prevents saving stale edits after an incoming configuration change", () => {
    const config = fixture(); const onSave = vi.fn(async () => undefined);
    const view = render(<AgentConfiguration config={config} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText("FLEX host"), { target: { value: "192.0.2.20" } });
    view.rerender(<AgentConfiguration config={{ ...config, commissioned: true }} onSave={onSave} />);
    expect(screen.getByRole("alert").textContent).toContain("changed while you were editing");
    expect(screen.getByRole("button", { name: "Review changes" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Discard / reload" }));
    expect((screen.getByLabelText("Commissioned") as HTMLInputElement).checked).toBe(true);
  });
});
