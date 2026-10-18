import { useEffect, useState } from "react";
import { clusterStatusColors, paletteColor } from "./clusterPalette";
import { ownSpotWindowMinutes, useOwnSpotWindowPreference } from "./ownSpotPreferences";
import { useSettingsSaveToast } from "./SettingsSaveToast";

type Configuration = {
  forwardSpotsToFlex: boolean;
  radioSpotColorPolicy?: "callsign" | "dxcc";
  palette: { status: Record<string, string> };
};
type Snapshot = { configuration: Configuration; flex_forwarding_available: boolean;
  forwarding?: { accepted_count: number; status: string } };
type Request = (method: string, params?: Record<string, unknown>) => Promise<any>;
const callsignStatuses = ["New Call", "New Band", "New Mode", "New Band+Mode"];
const dxccStatuses = ["ATNO", "C/New Band", "C/New Mode", "C/New Band+Mode", "W/New Band", "W/New Mode", "W/New Band+Mode"];
const sharedStatuses = ["Worked", "Confirmed", "Unknown"];
const statusNames = [...callsignStatuses, ...dxccStatuses, ...sharedStatuses];

export default function RadioSpotSettings({ request, visible }: { request: Request; visible: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [baseConfiguration, setBaseConfiguration] = useState<Configuration | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [policy, setPolicy] = useState<"callsign" | "dxcc">("callsign");
  const [statusColors, setStatusColors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ownSpotWindow = useOwnSpotWindowPreference();
  const saveToast = useSettingsSaveToast();
  async function refresh(preserveDraft = false) {
    try {
      const next = await request("cluster_snapshot") as Snapshot;
      setSnapshot(next);
      if (!preserveDraft) {
        setBaseConfiguration(next.configuration);
        setEnabled(next.configuration.forwardSpotsToFlex);
        setPolicy(next.configuration.radioSpotColorPolicy ?? "callsign");
        setStatusColors(next.configuration.palette.status);
      }
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Radio spot settings are unavailable."); }
  }
  useEffect(() => { if (visible) void refresh(); }, [visible]);
  const savedEnabled = snapshot?.configuration.forwardSpotsToFlex ?? false;
  const savedPolicy = snapshot?.configuration.radioSpotColorPolicy ?? "callsign";
  const baseEnabled = baseConfiguration?.forwardSpotsToFlex ?? false;
  const basePolicy = baseConfiguration?.radioSpotColorPolicy ?? "callsign";
  const color = (name: string) => paletteColor(name, statusColors, clusterStatusColors);
  const changedColors = Object.fromEntries(statusNames.filter(name => color(name) !==
    paletteColor(name, baseConfiguration?.palette.status, clusterStatusColors)).map(name => [name, color(name)]));
  const dirty = !!baseConfiguration && (enabled !== baseEnabled || policy !== basePolicy || Object.keys(changedColors).length > 0);
  const save = async () => {
    if (!baseConfiguration) return;
    const changes: Record<string, unknown> = {};
    if (enabled !== baseEnabled) { changes.flex_enabled = enabled; changes.flex_expected = baseEnabled; }
    if (policy !== basePolicy) { changes.color_policy = policy; changes.color_policy_expected = basePolicy; }
    if (Object.keys(changedColors).length) {
      changes.status_colors = changedColors;
      changes.status_color_expected = Object.fromEntries(Object.keys(changedColors)
        .map(name => [name, baseConfiguration.palette.status[name] ?? null]));
    }
    setBusy(true); setError("");
    try {
      await request("cluster_radio_spots_configure", changes);
      await refresh();
      saveToast.show("Radio spot settings saved");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Radio spot output could not be saved."); }
    finally { setBusy(false); }
  };
  const colorInputs = (names: string[]) => <div className="service-radio-spot-colors">{names.map(name =>
    <label key={name}>{name}<input type="color" aria-label={`${name} radio spot colour`} value={color(name)}
      onChange={event => setStatusColors(current => ({ ...current, [name]: event.target.value }))} /></label>)}</div>;
  return <section className="service-radio-spots" aria-label="Radio spot output">
    <h2>Radio spot output</h2>
    <p>Choose where classified cluster spots are sent. This is independent of receiving and displaying spots in xLog.</p>
    <fieldset>
      <legend>RBN / Spotted panel</legend>
      <label>Keep own-call pickups visible for <select aria-label="RBN and spotted display time" value={ownSpotWindow.minutes}
        onChange={event => ownSpotWindow.save(Number(event.target.value))}>
        {ownSpotWindowMinutes.map(minutes => <option key={minutes} value={minutes}>{minutes} minutes{minutes === 15 ? " · Default" : ""}</option>)}
      </select></label>
      <p>Saved automatically. This controls both the sidebar history query and the direct RBN pickup window.</p>
      {ownSpotWindow.error && <p role="alert">{ownSpotWindow.error}</p>}
    </fieldset>
    <fieldset disabled={busy || !snapshot}>
      <legend>FLEX / Maestro</legend>
      <label><input type="checkbox" checked={enabled} disabled={!snapshot?.flex_forwarding_available && !enabled}
        onChange={event => setEnabled(event.target.checked)} /> Forward spots through the connected Remote Station Agent</label>
      <p>{snapshot?.flex_forwarding_available
        ? "Requires an agent that advertises add_spot. A command accepted by the agent does not prove that the radio or Maestro displayed it. Direct FLEX LAN and xCat loopback do not provide this output."
        : "FLEX forwarding is unavailable on this platform. A saved enabled preference can be turned off."}</p>
      <p role="status">Saved: {savedEnabled ? "on" : "off"}. Runtime: {snapshot?.forwarding?.status ?? "Status unavailable"}{snapshot?.forwarding?.accepted_count ? ` · ${snapshot.forwarding.accepted_count} accepted by agent` : ""}</p>
    </fieldset>
    <fieldset disabled={busy || !snapshot}>
      <legend>Spot colour</legend>
      <label>Use status of <select aria-label="Radio spot colour status" value={policy} onChange={event => setPolicy(event.target.value as "callsign" | "dxcc")}>
        <option value="callsign">Callsign</option><option value="dxcc">DXCC</option>
      </select></label>
      <p>Colours distinguish new calls, bands and modes, plus whether a DXCC is confirmed or only worked overall. Your choices apply everywhere spots are shown.</p>
      <h3>Callsign status</h3>{colorInputs(callsignStatuses)}
      <h3>DXCC status</h3>{colorInputs(dxccStatuses)}
      <h3>Shared status</h3>{colorInputs(sharedStatuses)}
    </fieldset>
    <fieldset disabled><legend>SunSDR2 / TCI</legend>
      <label><input type="checkbox" disabled /> Send spots through TCI</label>
      <p>Unavailable: this app has TCI receive and tuning support, but no TCI spot output transport. Configure the TCI connection under Station control; enabling it there does not make spots appear on the radio.</p>
    </fieldset>
    <button type="button" disabled={busy || !dirty || (!snapshot?.flex_forwarding_available && enabled && enabled !== baseEnabled)} onClick={() => void save()}>Save radio spot output</button>
    <button type="button" disabled={busy} onClick={() => void refresh(true)}>Refresh status</button>
    {dirty && <p role="status">Changes are unsaved. Runtime remains {savedEnabled ? "on" : "off"} with {savedPolicy === "dxcc" ? "DXCC" : "callsign"} colours and the saved palette.</p>}
    {saveToast.toast}{error && <p role="alert">{error}</p>}
  </section>;
}
