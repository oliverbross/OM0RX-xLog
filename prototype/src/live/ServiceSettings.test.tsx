// @vitest-environment jsdom
import { useState, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClusterPanel } from "./ClusterPanel";
import ServiceSettings from "./ServiceSettings";
afterEach(cleanup);
const values = { operatorCall: "OM0RX", stationCall: "OM0RX", wavelogURL: "https://example.invalid", wavelogStationID: 1, qrzUsername: "operator", qrzEnabled: true, clubLogCTYURL: "https://example.invalid/cty", lotwActivityURL: "https://example.invalid/lotw", preservedUnknown: "retain" };
const qrzUploadOff = { enabled: false, enabled_at: null, pending_new_contacts: 0,
  states: { dispatching: 0, deferred: 0, delivered: 0, rejected: 0, uncertain: 0 }, latest_state: null };
type HarnessProps = Omit<ComponentProps<typeof ServiceSettings>, "values" | "onChanged" | "onSave"> & {
  values: Record<string, any>; onSave?: (value: Record<string, any>) => Promise<void>;
};
function SettingsHarness({ values: initial, onSave = async () => {}, ...props }: HarnessProps) {
  const [values, setValues] = useState(initial);
  return <ServiceSettings {...props} values={values} onChanged={setValues} onSave={onSave} />;
}
describe("grouped service settings", () => {
  it("names and exposes radio output before the Radio spots subsection", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "cluster_snapshot") return { configuration: { forwardSpotsToFlex: false, palette: { status: {} } }, flex_forwarding_available: true };
      if (method === "spot_bridge_snapshot") return { configuration: { enabled: false, logbookPort: 12062, contestPort: 12063, styles: {} }, running: false };
      return {};
    });
    render(<SettingsHarness values={values} request={request} />);
    fireEvent.click(screen.getByRole("tab", { name: "Radio spots" }));
    expect(await screen.findByRole("heading", { name: "Radio spot output" }, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Radio spots" })).toBeTruthy();
    expect(screen.getByLabelText("RBN and spotted display time")).toBeTruthy();
  });
  it("exposes Cluster as a first-class tab backed by the Cluster snapshot", async () => {
    const configuration = { servers: [{ id: "server", name: "ShackCQ", host: "cluster.example.invalid", port: 7300, callsign: "OM0RX", enabled: true }],
      connectOnStartup: true, requestRecentSpotsOnConnect: true, reconnect: false, requestSkimmer: false,
      showWorkedBandModeSpots: false, hideWSPRSpots: false, maximumSpots: 100, specialRules: [],
      palette: { status: { Worked: "#112233" }, band: { "20m": "#223344" }, mode: { CW: "#334455" } },
      filter: { query: "", bands: [], modes: [], continents: [], callStatuses: [], dxccStatuses: [], specials: [], sources: ["cluster", "rbl"], worked: [], sort: "newest" },
      commandPresets: [], forwardSpotsToFlex: false };
    const request = vi.fn(async (method: string) => method === "cluster_snapshot" ? { configuration, password_servers: [] } : {});
    render(<SettingsHarness values={values} request={request}
      clusterSettings={<ClusterPanel settingsOnly snapshot={null} onRequest={request} onSelect={vi.fn()} />} />);

    fireEvent.click(screen.getByRole("tab", { name: "Cluster" }));
    await screen.findByLabelText("ShackCQ host");
    expect(request).toHaveBeenCalledWith("cluster_snapshot", {});
    expect(screen.getByLabelText("Worked")).toBeTruthy();
    expect(screen.getByLabelText("20m")).toBeTruthy();
    expect(screen.getByLabelText("CW")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save cluster settings" })).toBeTruthy();
  });

  it("defaults measured power capture OFF and saves opt-in only with settings", async () => {
    const request = vi.fn();
    const profile = { ...values, defaultPower: "100", automaticTransmitPower: false }, saved = vi.fn(async () => {});
    render(<SettingsHarness values={profile} request={request} onSave={saved} />);
    const toggle = screen.getByRole("checkbox", { name: "Automatic measured power" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false); expect(toggle.disabled).toBe(false);
    expect(toggle.closest(".service-default-power")?.contains(screen.getByLabelText("Default power W"))).toBe(true);
    expect(screen.getByLabelText("Operator call").closest(".service-station-identity-fields")).toBeTruthy();
    expect(screen.getByText(/active radio or amplifier/)).toBeTruthy();
    expect(screen.queryByText(/Capture KPA500/)).toBeNull();
    fireEvent.click(toggle); expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ ...profile, automaticTransmitPower: true }));
    expect(request).not.toHaveBeenCalled();
  });
  it("keeps capture dormant when an older worker omits the setting", () => {
    render(<SettingsHarness values={values} request={vi.fn()} />);
    expect((screen.getByRole("checkbox", { name: "Automatic measured power" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Automatic capture is unavailable in this version.")).toBeTruthy();
  });
  it("defaults Clear after QSY OFF and persists only the explicit opt-in", async () => {
    const request = vi.fn(), saved = vi.fn(async () => {});
    const profile = { ...values, clearAfterQSY: false };
    render(<SettingsHarness values={profile} request={request} onSave={saved} />);
    const toggle = screen.getByRole("checkbox", { name: "Clear unlogged QSO after QSY" }) as HTMLInputElement;
    expect(toggle.checked).toBe(false); expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith({ ...profile, clearAfterQSY: true }));
    expect(request).not.toHaveBeenCalled();
  });
  it("keeps Clear after QSY unavailable when an older worker omits it", () => {
    render(<SettingsHarness values={values} request={vi.fn()} />);
    expect((screen.getByRole("checkbox", { name: "Clear unlogged QSO after QSY" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Clear after QSY is unavailable in this version.")).toBeTruthy();
  });
  it("applies standalone mode only on Save, retaining Wavelog setup without starting sync", async () => {
    const request = vi.fn(), save = vi.fn(async () => {});
    render(<SettingsHarness values={{ ...values, logbookMode: "wavelog" }} request={request} onSave={save} />);
    expect(screen.getByRole("tab", { name: "Logbook" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Logbook" }));
    expect(screen.getByRole("heading", { name: "Integrated logbook" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Integrated logbook only" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Integrated logbook + Wavelog synchronization" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Logbook mode"), { target: { value: "local" } });
    expect(screen.getByText(/Selected mode \(save to apply\): Integrated only/)).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...values, logbookMode: "local" }));
    expect(request.mock.calls.some(([method]) => method.startsWith("sync_"))).toBe(false);
  });
  it("defaults missing mode to local and switching back only saves settings", async () => {
    const request = vi.fn(), save = vi.fn(async () => {});
    render(<SettingsHarness values={values} request={request} onSave={save} />);
    fireEvent.click(screen.getByRole("tab", { name: "Logbook" }));
    expect((screen.getByLabelText("Logbook mode") as HTMLSelectElement).value).toBe("local");
    expect(screen.getByText(/Switching back to Wavelog leaves synchronization off/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Logbook mode"), { target: { value: "wavelog" } });
    expect(save).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...values, logbookMode: "wavelog" }));
    expect(request).not.toHaveBeenCalled();
  });
  it("puts rotator settings in their own tab without applying a connection change", () => {
    const request = vi.fn();
    render(<SettingsHarness values={values} request={request} rotorSettings={<div>Independent rotor setup</div>} />);
    fireEvent.click(screen.getByRole("tab", { name: "Rotator" }));
    expect(screen.getByRole("tabpanel", { name: "Rotator" }).textContent).toContain("Independent rotor setup");
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  it("shows service details and reads only credential presence when Wavelog is first visible", async () => {
    const request = vi.fn(async (method: string) => method === "online_log_status" ? qrzUploadOff : ({ "wavelog-token": false, "qrz-logbook-key": false }));
    render(<SettingsHarness values={values} request={request} />);
    expect(screen.getByRole("tabpanel", { name: "General" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Wavelog" }));
    expect((screen.getByRole("textbox", { name: "Wavelog URL" }) as HTMLInputElement).value).toBe(values.wavelogURL);
    fireEvent.click(screen.getByRole("tab", { name: "Callsign lookup" }));
    expect((screen.getByRole("textbox", { name: "QRZ username" }) as HTMLInputElement).value).toBe("operator");
    fireEvent.click(screen.getByRole("tab", { name: "Online logs" }));
    expect(screen.getByText(/Saving it securely does not enable uploads/)).toBeTruthy();
    expect(screen.getByLabelText("QRZ Logbook API key")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Reference data" }));
    expect(screen.getByText(/Saving it here never enables uploads/)).toBeTruthy();
    await waitFor(() => expect(request).toHaveBeenCalledWith("online_log_status", { service: "club_log" }));
    expect(request).toHaveBeenCalledWith("secret_status");
  });
  it("tests QRZ only after an explicit click and reports a successful OM0AAO match", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => method === "lookup_call"
      ? { call: params?.call, country: "SLOVAK REPUBLIC", dxcc: 504, qrz_status: "matched" } : {});
    render(<SettingsHarness values={values} request={request} />);
    fireEvent.click(screen.getByRole("tab", { name: "Callsign lookup" }));
    expect(request).not.toHaveBeenCalledWith("lookup_call", expect.anything());
    fireEvent.change(screen.getByLabelText("QRZ test callsign"), { target: { value: "om0aao" } });
    fireEvent.click(screen.getByRole("button", { name: "Test QRZ lookup" }));
    await screen.findByText("QRZ matched OM0AAO · SLOVAK REPUBLIC.");
    expect(request).toHaveBeenCalledWith("lookup_call", { call: "OM0AAO" });
  });
  it("shows the retained offline result when an authorized QRZ test cannot reach the provider", async () => {
    const warning = "QRZ request timed out. Check the connection and try again. Offline CTY result retained.";
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => method === "lookup_call"
      ? { call: params?.call, country: "SLOVAK REPUBLIC", dxcc: 504, qrz_status: "unavailable", lookup_warning: warning } : {});
    render(<SettingsHarness values={values} request={request} />);
    fireEvent.click(screen.getByRole("tab", { name: "Callsign lookup" }));
    fireEvent.change(screen.getByLabelText("QRZ test callsign"), { target: { value: "OM0AAO" } });
    fireEvent.click(screen.getByRole("button", { name: "Test QRZ lookup" }));
    await screen.findByText(warning);
    expect(screen.queryByText(/Operation failed/)).toBeNull();
  });
  it("requires a provider change to be saved before testing the persisted shared lookup route", async () => {
    const request = vi.fn(async () => ({}));
    render(<SettingsHarness values={{ ...values, hamqthUsername: "ham-operator" }} savedValues={values} request={request} />);
    fireEvent.click(screen.getByRole("tab", { name: "Callsign lookup" }));
    fireEvent.change(screen.getByLabelText("Lookup provider"), { target: { value: "hamqth" } });
    expect((screen.getByRole("button", { name: "Test HamQTH lookup" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Save settings to apply HamQTH before testing.")).toBeTruthy();
    expect(request).not.toHaveBeenCalledWith("lookup_call", expect.anything());
  });
  it("uses the saved HamQTH provider without overwriting retained QRZ settings", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => method === "lookup_call"
      ? { call: params?.call, country: "SLOVAK REPUBLIC", lookup_status: "matched", lookup_provider: "HamQTH", source: "HamQTH XML" }
      : method === "secret_status" ? { "hamqth-password": true } : {});
    const save = vi.fn(async () => {});
    const providerValues = { ...values, callsignLookupProvider: "hamqth", hamqthUsername: "ham-operator" };
    render(<SettingsHarness values={providerValues} savedValues={providerValues} request={request} onSave={save} />);
    fireEvent.click(screen.getByRole("tab", { name: "Callsign lookup" }));
    expect((screen.getByLabelText("HamQTH username") as HTMLInputElement).value).toBe("ham-operator");
    expect(screen.queryByLabelText("QRZ username")).toBeNull();
    fireEvent.change(screen.getByLabelText("HamQTH test callsign"), { target: { value: "OM0AAO" } });
    fireEvent.click(screen.getByRole("button", { name: "Test HamQTH lookup" }));
    await screen.findByText("HamQTH matched OM0AAO · SLOVAK REPUBLIC.");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      callsignLookupProvider: "hamqth", hamqthUsername: "ham-operator", qrzUsername: "operator", qrzEnabled: true,
    })));
  });
  it("saves the separate QRZ Logbook key without enabling or saving upload settings", async () => {
    const request = vi.fn(async (method: string) => method === "secret_status"
      ? { "qrz-logbook-key": false } : method === "online_log_status" ? qrzUploadOff : { saved: true });
    const save = vi.fn(async () => {});
    render(<SettingsHarness values={values} request={request} onSave={save} />);
    fireEvent.click(screen.getByRole("tab", { name: "Online logs" }));
    const key = screen.getByLabelText("QRZ Logbook API key") as HTMLInputElement;
    fireEvent.change(key, { target: { value: "unit-test-qrz-logbook-key" } });
    fireEvent.click(screen.getByRole("button", { name: "Save QRZ Logbook API key" }));
    await screen.findByText("QRZ Logbook API key saved securely.");
    expect(key.value).toBe("");
    expect(screen.getByText("Saved securely. Use the enrollment control below.")).toBeTruthy();
    expect(request).toHaveBeenCalledWith("secret_save", {
      account: "qrz-logbook-key", value: "unit-test-qrz-logbook-key",
    });
    expect(save).not.toHaveBeenCalled();
  });
  it("requires explicit prospective-only confirmation before enabling QRZ uploads", async () => {
    const request = vi.fn(async (method: string) => method === "secret_status" ? { "qrz-logbook-key": true }
      : method === "online_log_status" ? qrzUploadOff
      : method === "online_log_configure" ? { ...qrzUploadOff, enabled: true, enabled_at: "2026-10-15T00:00:00Z" }
      : {});
    render(<SettingsHarness values={values} request={request} />);
    fireEvent.click(screen.getByRole("tab", { name: "Online logs" }));
    const qrzUpload = screen.getByLabelText("QRZ upload");
    await within(qrzUpload).findByText(/Upload is OFF/);
    fireEvent.click(within(qrzUpload).getByRole("checkbox", { name: "Upload new contacts to QRZ" }));
    const enable = screen.getByRole("button", { name: "Enable QRZ uploads" }) as HTMLButtonElement;
    expect(enable.disabled).toBe(true);
    expect(within(qrzUpload).getByText(/WSJT-X Logged ADIF/)).toBeTruthy();
    expect(within(qrzUpload).getByText(/Existing contacts, file imports, Wavelog pulls/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "I understand and want to enroll new contacts from now on" }));
    fireEvent.click(enable);
    await screen.findByText("QRZ upload enabled for contacts logged from now on.");
    expect(request).toHaveBeenCalledWith("online_log_configure", { service: "qrz", enabled: true, confirm_new_contacts_only: true });
  });
  it("removing the QRZ upload key uses an empty secure write and refreshes disabled status", async () => {
    let removed = false;
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "secret_status") return { "qrz-logbook-key": true };
      if (method === "secret_save" && params?.value === "") { removed = true; return { saved: false }; }
      if (method === "online_log_status") return { ...qrzUploadOff, enabled: !removed };
      return {};
    });
    render(<SettingsHarness values={values} request={request} />);
    fireEvent.click(screen.getByRole("tab", { name: "Online logs" }));
    const remove = await screen.findByRole("button", { name: "Remove QRZ Logbook API key" });
    fireEvent.click(remove);
    await screen.findByText("QRZ Logbook API key removed securely.");
    expect(request).toHaveBeenCalledWith("secret_save", { account: "qrz-logbook-key", value: "" });
    await within(screen.getByLabelText("QRZ upload")).findByText(/Upload is OFF/);
  });
  it("keeps Club Log separate, requires confirmation and explains refusal shutdown", async () => {
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => method === "secret_status" ? {
      "qrz-logbook-key": false, "clublog-email": true, "clublog-application-password": true,
      "clublog-callsign": true, "clublog-api-key": true,
    } : method === "online_log_status" ? qrzUploadOff
      : method === "online_log_configure" ? { ...qrzUploadOff, enabled: true } : {});
    render(<SettingsHarness values={values} request={request} />);
    fireEvent.click(screen.getByRole("tab", { name: "Online logs" }));
    expect((screen.getByLabelText("Club Log account email") as HTMLInputElement).type).toBe("text");
    expect((screen.getByLabelText("Club Log Application Password") as HTMLInputElement).type).toBe("password");
    expect((screen.getByLabelText("Club Log callsign") as HTMLInputElement).type).toBe("text");
    const clubLog = screen.getByLabelText("Club Log upload");
    await within(clubLog).findByText(/Upload is OFF/);
    expect(within(clubLog).getByText(/immediately switches Club Log upload off/)).toBeTruthy();
    fireEvent.click(within(clubLog).getByRole("checkbox", { name: "Upload new contacts to Club Log" }));
    const enable = within(clubLog).getByRole("button", { name: "Enable Club Log uploads" }) as HTMLButtonElement;
    expect(enable.disabled).toBe(true);
    fireEvent.click(within(clubLog).getByRole("checkbox", { name: "I understand and want to enroll new contacts from now on" }));
    fireEvent.click(enable);
    await within(clubLog).findByText("Club Log upload enabled for contacts logged from now on.");
    expect(request).toHaveBeenCalledWith("online_log_configure", {
      service: "club_log", enabled: true, confirm_new_contacts_only: true,
    });
  });
  it("shows safe per-contact upload review without offering retry-all", async () => {
    const review = { ...qrzUploadOff, generation: "fixture-generation", provider_issue_code: "credential_unavailable", states: { ...qrzUploadOff.states, uncertain: 1 }, latest_state: "uncertain",
      latest_error_code: "transport_unknown", attention: [{ contact_id: "fixture-contact", contact_revision: 4,
        current_revision: true, call: "VK8REVIEW", started_at: "2026-10-22T01:02:03Z", band: "15m", mode: "FT4",
        state: "uncertain", last_attempt_at: "2026-10-22T01:03:00Z", safe_error_code: "transport_unknown",
        review_method: "logbook_follow_up", available_actions: ["inspect", "confirm_delivered"] }] };
    const reconciled = { ...review, states: { ...review.states, uncertain: 0, delivered: 1 }, attention: [] };
    const request = vi.fn(async (method: string, params?: Record<string, unknown>) => method === "secret_status"
      ? { "qrz-logbook-key": true } : method === "online_log_status" && params?.service === "qrz" ? review
      : method === "online_log_reconcile" ? reconciled : qrzUploadOff);
    render(<SettingsHarness values={values} request={request} />);
    fireEvent.click(screen.getByRole("tab", { name: "Online logs" }));
    const panel = await screen.findByLabelText("QRZ contacts requiring review");
    expect(screen.getByText("Provider setup needs attention: credential unavailable.")).toBeTruthy();
    expect(within(panel).getByText("VK8REVIEW")).toBeTruthy();
    expect(within(panel).getByText(/will not retry or change it automatically/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /retry all/i })).toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Mark VK8REVIEW verified delivered" }));
    const confirm = within(panel).getByRole("group", { name: "Confirm VK8REVIEW reconciliation" });
    const action = within(confirm).getByRole("button", { name: "Confirm delivered" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    fireEvent.click(within(confirm).getByRole("checkbox", { name: "I verified this contact at QRZ" }));
    fireEvent.click(action);
    await screen.findByText("QRZ outcome for VK8REVIEW reconciled as delivered.");
    expect(request).toHaveBeenCalledWith("online_log_reconcile", { service: "qrz", contact_id: "fixture-contact",
      contact_revision: 4, generation: "fixture-generation", action: "confirm_delivered", confirm_remote_state: true });
    expect(request.mock.calls.filter(([method]) => method === "online_log_status")).toHaveLength(2);
  });
  it("saves a credential separately, clears its input and never sends it with settings", async () => {
    const request = vi.fn(async () => ({ saved: true }));
    const saved = vi.fn(async () => {});
    render(<SettingsHarness values={values} request={request} onSave={saved} />);
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
    expect(saved).toHaveBeenCalledWith(values);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("keeps unsaved settings and secret inputs across tabs without loading or persisting secret values", async () => {
    const request = vi.fn(async (_method: string) => ({})), save = vi.fn(async () => {});
    render(<SettingsHarness values={values} request={request} onSave={save} />);
    fireEvent.change(screen.getByLabelText("Station call"), { target: { value: "M7KOD" } });
    fireEvent.click(screen.getByRole("tab", { name: "Wavelog" }));
    fireEvent.change(screen.getByLabelText("Wavelog URL"), { target: { value: "https://new.example.invalid/" } });
    fireEvent.change(screen.getByLabelText("Wavelog API v2 token"), { target: { value: "typed-test-token" } });
    fireEvent.click(screen.getByRole("tab", { name: "Callsign lookup" }));
    fireEvent.change(screen.getByLabelText("QRZ password"), { target: { value: "typed-test-password" } });
    fireEvent.click(screen.getByRole("tab", { name: "Backups" }));
    fireEvent.click(screen.getByRole("tab", { name: "Wavelog" }));
    expect((screen.getByLabelText("Wavelog URL") as HTMLInputElement).value).toBe("https://new.example.invalid/");
    expect((screen.getByLabelText("Wavelog API v2 token") as HTMLInputElement).value).toBe("typed-test-token");
    fireEvent.click(screen.getByRole("tab", { name: "Callsign lookup" }));
    expect((screen.getByLabelText("QRZ password") as HTMLInputElement).value).toBe("typed-test-password");
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    expect((screen.getByLabelText("Station call") as HTMLInputElement).value).toBe("M7KOD");
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenCalledWith("secret_status");
    expect(request.mock.calls.filter(([method]) => method === "online_log_status")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...values, stationCall: "M7KOD", wavelogURL: "https://new.example.invalid/" }));
    expect(JSON.stringify(request.mock.calls)).not.toContain("typed-test-token");
    expect(JSON.stringify(request.mock.calls)).not.toContain("typed-test-password");
  });
  it("saves an implicit-FTPS destination and password through separate settings and Keychain paths", async () => {
    const request = vi.fn(async (method: string) => method === "secret_status"
      ? { "ftp-backup-password": false } : { saved: true });
    const save = vi.fn(async () => {});
    render(<SettingsHarness values={values} request={request} onSave={save} />);
    fireEvent.click(screen.getByRole("tab", { name: "Backups" }));
    fireEvent.change(screen.getByLabelText("Remote backup protocol"), { target: { value: "ftps" } });
    fireEvent.change(screen.getByLabelText("FTP server endpoint"), { target: { value: "ftps://backup.example.test:990" } });
    fireEvent.change(screen.getByLabelText("Remote directory"), { target: { value: "/xlog" } });
    fireEvent.change(screen.getByLabelText("FTP username"), { target: { value: "operator" } });
    const password = screen.getByLabelText("FTP / FTPS password") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Save FTP / FTPS password" }));
    await screen.findByText("FTP / FTPS password saved securely.");
    expect(request).toHaveBeenCalledWith("secret_save", {
      account: "ftp-backup-password", value: "test-password",
    });
    fireEvent.click(screen.getByRole("button", { name: "Save backup settings" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ ...values, ftpBackup: {
      protocol: "ftps", endpoint: "ftps://backup.example.test:990", directory: "/xlog",
      username: "operator", plainFTPConfirmed: false,
    } }));
    expect(JSON.stringify(save.mock.calls)).not.toContain("test-password");
  });
  it("switches tabs with arrow keys and keeps reference/backup tools mounted without duplicate reads", async () => {
    const request = vi.fn(async () => ({}));
    const dataRequest = vi.fn(async (method: string) => method === "backup_list" ? { backups: [] } : { running: false, status: "Not refreshed in this session", cty_source: "bundled", state: {} });
    render(<SettingsHarness values={values} request={request} dataRequest={dataRequest} onDataChanged={vi.fn()} />);
    await waitFor(() => expect(dataRequest).toHaveBeenCalledTimes(2));
    fireEvent.keyDown(screen.getByRole("tab", { name: "General" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Radio" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Radio" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Logbook" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Logbook" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Wavelog" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Reference data" }));
    expect(screen.getByRole("table", { name: "Reference dataset evidence" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Club Log CTY URL" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "LoTW activity URL" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create backup" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Backups" }));
    expect(screen.getByRole("button", { name: "Create backup" })).toBeTruthy();
    expect(screen.queryByRole("table", { name: "Reference dataset evidence" })).toBeNull();
    expect(dataRequest).toHaveBeenCalledTimes(3);
    expect(dataRequest).toHaveBeenCalledWith("remote_backup_request", { action: "snapshot" });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenCalledWith("secret_status");
  });

  it("masks saved Wavelog credentials without exposing or claiming to validate a stored secret", async () => {
    const request = vi.fn(async () => ({ "wavelog-token": true }));
    render(<SettingsHarness values={values} request={request} />);
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Wavelog" }));
    await screen.findByText("Saved securely. Not verified for this Wavelog URL and station ID.");
    const token = screen.getByLabelText("Wavelog API v2 token") as HTMLInputElement;
    expect(token.type).toBe("password"); expect(token.value).toBe("");
    expect(token.placeholder).toContain("••••••••");
    expect(screen.getByRole("button", { name: "Save Wavelog API v2 token" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Wavelog URL"), { target: { value: "https://another.invalid" } });
    expect(screen.getByText(/Not verified for this Wavelog URL/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.click(screen.getByRole("tab", { name: "Wavelog" }));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps saved status honest when the presence check fails", async () => {
    const request = vi.fn(async () => { throw new Error("denied"); });
    render(<SettingsHarness values={values} request={request} requestedTab="Wavelog" />);
    await screen.findByText("Saved credential status unavailable. Keychain access may need attention.");
    expect((screen.getByLabelText("Wavelog API v2 token") as HTMLInputElement).placeholder).toBe("");
  });

  it("does not let a late presence check erase a newly saved token", async () => {
    let resolveStatus!: (value: Record<string, boolean>) => void;
    const request = vi.fn(async (method: string) => method === "secret_status" ? new Promise<Record<string, boolean>>(resolve => { resolveStatus = resolve; }) : { saved: true });
    render(<SettingsHarness values={values} request={request} requestedTab="Wavelog" />);
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
    render(<SettingsHarness values={values} request={request} requestedTab="Wavelog" />);
    const token = screen.getByLabelText("Wavelog API v2 token") as HTMLInputElement;
    fireEvent.change(token, { target: { value: "retry-test-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Wavelog API v2 token" }));
    await screen.findByText(/Could not save Wavelog API v2 token/);
    expect(token.value).toBe("retry-test-token");
    expect(screen.getByText(/Saved credential status unavailable/)).toBeTruthy();
    expect(screen.queryByText("Checking saved credential…")).toBeNull();
  });

  it("groups QRZ and Club Log fields with their secure Save button", () => {
    render(<SettingsHarness values={values} request={vi.fn(async () => ({}))} />);
    fireEvent.click(screen.getByRole("tab", { name: "Callsign lookup" }));
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
    const { rerender } = render(<SettingsHarness values={values} request={request} syncSettings={<button>Run sync fixture</button>} />);
    expect(screen.queryByRole("button", { name: "Run sync fixture" })).toBeNull();
    rerender(<SettingsHarness values={values} request={request} requestedTab="Sync" syncSettings={<button>Run sync fixture</button>} />);
    const sync = screen.getByRole("button", { name: "Run sync fixture" });
    expect(sync.closest("form")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save settings" })).toBeNull();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    expect(screen.queryByRole("button", { name: "Run sync fixture" })).toBeNull();
    rerender(<SettingsHarness values={values} request={request} requestedTab="Sync" requestedTabRevision={1} syncSettings={<button>Run sync fixture</button>} />);
    expect(screen.getByRole("button", { name: "Run sync fixture" })).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
  });
});
