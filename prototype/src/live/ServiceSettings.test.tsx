// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ServiceSettings from "./ServiceSettings";
afterEach(cleanup);
const values = { operatorCall: "OM0RX", stationCall: "OM0RX", wavelogURL: "https://example.invalid", wavelogStationID: 1, qrzUsername: "operator", qrzEnabled: true, clubLogCTYURL: "https://example.invalid/cty", lotwActivityURL: "https://example.invalid/lotw", preservedUnknown: "retain" };
describe("grouped service settings", () => {
  it("defaults measured power capture OFF and saves opt-in only with settings", async () => {
    const request = vi.fn(async (_method: string, params?: Record<string, any>) => ({ settings: params?.settings }));
    const profile = { ...values, defaultPower: "100", automaticTransmitPower: false }, saved = vi.fn();
    render(<ServiceSettings values={profile} request={request} onSaved={saved} />);
    const toggle = screen.getByRole("checkbox", { name: "Automatic measured power" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false); expect(toggle.disabled).toBe(false);
    expect(toggle.closest(".service-default-power")?.contains(screen.getByLabelText("Default power W"))).toBe(true);
    expect(screen.getByText(/Capture KPA500 measured output/)).toBeTruthy();
    fireEvent.click(toggle); expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ ...profile, automaticTransmitPower: true }));
    expect(request).toHaveBeenCalledWith("settings_save", { settings: { ...profile, automaticTransmitPower: true } });
  });
  it("keeps capture dormant when an older worker omits the setting", () => {
    render(<ServiceSettings values={values} request={vi.fn()} onSaved={vi.fn()} />);
    expect((screen.getByRole("checkbox", { name: "Automatic measured power" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Automatic capture is unavailable in this version.")).toBeTruthy();
  });
  it("applies standalone mode only on Save, retaining Wavelog setup without starting sync", async () => {
    const request = vi.fn(async (_method: string, params?: Record<string, any>) => ({ settings: params?.settings }));
    render(<ServiceSettings values={{ ...values, logbookMode: "wavelog" }} request={request} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Logbook mode"), { target: { value: "local" } });
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("settings_save", { settings: { ...values, logbookMode: "local" } }));
    expect(request.mock.calls.some(([method]) => method.startsWith("sync_"))).toBe(false);
  });
  it("puts rotator settings in their own tab without applying a connection change", () => {
    const request = vi.fn();
    render(<ServiceSettings values={values} request={request} onSaved={vi.fn()} rotorSettings={<div>Independent rotor setup</div>} />);
    fireEvent.click(screen.getByRole("tab", { name: "Rotator" }));
    expect(screen.getByRole("tabpanel", { name: "Rotator" }).textContent).toContain("Independent rotor setup");
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  it("shows service details and reads only credential presence when Wavelog is first visible", async () => {
    const request = vi.fn(async () => ({ "wavelog-token": false }));
    render(<ServiceSettings values={values} request={request} onSaved={vi.fn()} />);
    expect(screen.getByRole("tabpanel", { name: "Station" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Wavelog" }));
    expect((screen.getByRole("textbox", { name: "Wavelog URL" }) as HTMLInputElement).value).toBe(values.wavelogURL);
    fireEvent.click(screen.getByRole("tab", { name: "QRZ" }));
    expect((screen.getByRole("textbox", { name: "QRZ username" }) as HTMLInputElement).value).toBe("operator");
    fireEvent.click(screen.getByRole("tab", { name: "Reference data" }));
    expect(screen.getByText(/not a Club Log QSO uploader/)).toBeTruthy();
    await waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(request).toHaveBeenCalledWith("secret_status");
  });
  it("saves a credential separately, clears its input and never sends it with settings", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, any>) => method === "settings_save" ? { settings: params?.settings } : { saved: true });
    const saved = vi.fn();
    render(<ServiceSettings values={values} request={request} onSaved={saved} />);
    fireEvent.click(screen.getByRole("tab", { name: "Wavelog" }));
    const token = screen.getByLabelText("Wavelog API v2 token") as HTMLInputElement;
    fireEvent.change(token, { target: { value: "unit-test-only-not-a-real-secret" } });
    fireEvent.keyDown(token, { key: "Enter" });
    await screen.findByText("Wavelog API v2 token saved securely.");
    expect(token.type).toBe("password"); expect(token.value).toBe("");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith("secret_save", { account: "wavelog-token", value: "unit-test-only-not-a-real-secret" });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith(values));
    expect(request).toHaveBeenLastCalledWith("settings_save", { settings: values });
  });
  it("keeps unsaved settings and secret inputs across tabs without loading or persisting secret values", async () => {
    const request = vi.fn(async (_method: string, params?: Record<string, any>) => ({ settings: params?.settings }));
    render(<ServiceSettings values={values} request={request} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Station call"), { target: { value: "M7KOD" } });
    fireEvent.click(screen.getByRole("tab", { name: "Wavelog" }));
    fireEvent.change(screen.getByLabelText("Wavelog URL"), { target: { value: "https://new.example.invalid/" } });
    fireEvent.change(screen.getByLabelText("Wavelog API v2 token"), { target: { value: "typed-test-token" } });
    fireEvent.click(screen.getByRole("tab", { name: "QRZ" }));
    fireEvent.change(screen.getByLabelText("QRZ password"), { target: { value: "typed-test-password" } });
    fireEvent.click(screen.getByRole("tab", { name: "Backups" }));
    fireEvent.click(screen.getByRole("tab", { name: "Wavelog" }));
    expect((screen.getByLabelText("Wavelog URL") as HTMLInputElement).value).toBe("https://new.example.invalid/");
    expect((screen.getByLabelText("Wavelog API v2 token") as HTMLInputElement).value).toBe("typed-test-token");
    fireEvent.click(screen.getByRole("tab", { name: "QRZ" }));
    expect((screen.getByLabelText("QRZ password") as HTMLInputElement).value).toBe("typed-test-password");
    fireEvent.click(screen.getByRole("tab", { name: "Station" }));
    expect((screen.getByLabelText("Station call") as HTMLInputElement).value).toBe("M7KOD");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("secret_status");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("settings_save", { settings: { ...values, stationCall: "M7KOD", wavelogURL: "https://new.example.invalid/" } }));
    expect(JSON.stringify(request.mock.calls)).not.toContain("typed-test-token");
    expect(JSON.stringify(request.mock.calls)).not.toContain("typed-test-password");
  });
  it("switches tabs with arrow keys and keeps reference/backup tools mounted without duplicate reads", async () => {
    const request = vi.fn(async () => ({}));
    const dataRequest = vi.fn(async (method: string) => method === "backup_list" ? { backups: [] } : { running: false, status: "Not refreshed in this session", cty_source: "bundled", state: {} });
    render(<ServiceSettings values={values} request={request} dataRequest={dataRequest} onDataChanged={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(dataRequest).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(screen.getByRole("tab", { name: "Station" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Wavelog" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Reference data" }));
    expect(screen.getByRole("table", { name: "Reference dataset evidence" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Club Log CTY URL" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "LoTW activity URL" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create backup" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Backups" }));
    expect(screen.getByRole("button", { name: "Create backup" })).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Reference dataset evidence" })).toBeNull();
    expect(dataRequest).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("secret_status");
  });

  it("masks saved Wavelog credentials without exposing or claiming to validate a stored secret", async () => {
    const request = vi.fn(async () => ({ "wavelog-token": true }));
    render(<ServiceSettings values={values} request={request} onSaved={vi.fn()} />);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Wavelog" }));
    await screen.findByText("Saved securely. Not verified for this Wavelog URL and station ID.");
    const token = screen.getByLabelText("Wavelog API v2 token") as HTMLInputElement;
    expect(token.type).toBe("password"); expect(token.value).toBe("");
    expect(token.placeholder).toContain("••••••••");
    expect(screen.getByRole("button", { name: "Save Wavelog API v2 token" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Wavelog URL"), { target: { value: "https://another.invalid" } });
    expect(screen.getByText(/Not verified for this Wavelog URL/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Station" }));
    fireEvent.click(screen.getByRole("tab", { name: "Wavelog" }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps saved status honest when the presence check fails", async () => {
    const request = vi.fn(async () => { throw new Error("denied"); });
    render(<ServiceSettings values={values} request={request} onSaved={vi.fn()} requestedTab="Wavelog" />);
    await screen.findByText("Saved token status unavailable. Keychain access may need attention.");
    expect((screen.getByLabelText("Wavelog API v2 token") as HTMLInputElement).placeholder).toBe("");
  });

  it("does not let a late presence check erase a newly saved token", async () => {
    let resolveStatus!: (value: Record<string, boolean>) => void;
    const request = vi.fn(async (method: string) => method === "secret_status" ? new Promise<Record<string, boolean>>(resolve => { resolveStatus = resolve; }) : { saved: true });
    render(<ServiceSettings values={values} request={request} onSaved={vi.fn()} requestedTab="Wavelog" />);
    fireEvent.change(screen.getByLabelText("Wavelog API v2 token"), { target: { value: "test-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Wavelog API v2 token" }));
    await screen.findByText("Saved securely. Not verified for this Wavelog URL and station ID.");
    resolveStatus({ "wavelog-token": false });
    await waitFor(() => expect((screen.getByLabelText("Wavelog API v2 token") as HTMLInputElement).placeholder).toContain("saved"));
  });

  it("retains a replacement token and reports uncertain status when saving fails during the presence check", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "secret_status") return new Promise<Record<string, boolean>>(() => {});
      throw new Error("denied");
    });
    render(<ServiceSettings values={values} request={request} onSaved={vi.fn()} requestedTab="Wavelog" />);
    const token = screen.getByLabelText("Wavelog API v2 token") as HTMLInputElement;
    fireEvent.change(token, { target: { value: "retry-test-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Wavelog API v2 token" }));
    await screen.findByText(/Could not save Wavelog API v2 token/);
    expect(token.value).toBe("retry-test-token");
    expect(screen.getByText(/Saved token status unavailable/)).toBeTruthy();
    expect(screen.queryByText("Checking saved token…")).toBeNull();
  });

  it("groups QRZ and Club Log fields with their secure Save button", () => {
    render(<ServiceSettings values={values} request={vi.fn()} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "QRZ" }));
    const qrzRow = screen.getByLabelText("QRZ username").closest(".service-account-row");
    expect(qrzRow?.contains(screen.getByLabelText("QRZ password"))).toBe(true);
    expect(qrzRow?.contains(screen.getByRole("button", { name: "Save QRZ password" }))).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "Reference data" }));
    const clubRow = screen.getByLabelText("Club Log CTY URL").closest(".service-account-row");
    expect(clubRow?.contains(screen.getByLabelText("Club Log API key"))).toBe(true);
    expect(clubRow?.contains(screen.getByRole("button", { name: "Save Club Log API key" }))).toBe(true);
  });

  it("mounts Sync only when selected and follows requested tabs without changing settings", () => {
    const request = vi.fn();
    const { rerender } = render(<ServiceSettings values={values} request={request} onSaved={vi.fn()} syncSettings={<button>Run sync fixture</button>} />);
    expect(screen.queryByRole("button", { name: "Run sync fixture" })).toBeNull();
    rerender(<ServiceSettings values={values} request={request} onSaved={vi.fn()} requestedTab="Sync" syncSettings={<button>Run sync fixture</button>} />);
    const sync = screen.getByRole("button", { name: "Run sync fixture" });
    expect(sync.closest("form")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Station" }));
    expect(screen.queryByRole("button", { name: "Run sync fixture" })).toBeNull();
    rerender(<ServiceSettings values={values} request={request} onSaved={vi.fn()} requestedTab="Sync" requestedTabRevision={1} syncSettings={<button>Run sync fixture</button>} />);
    expect(screen.getByRole("button", { name: "Run sync fixture" })).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
});
