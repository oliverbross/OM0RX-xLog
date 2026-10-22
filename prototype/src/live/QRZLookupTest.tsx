import { useState } from "react";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<Data>;

export default function QRZLookupTest({ request, defaultCall, provider = "QRZ", applied = true }: {
  request: Request; defaultCall: string; provider?: "QRZ" | "HamQTH"; applied?: boolean;
}) {
  const [call, setCall] = useState(defaultCall.trim().toUpperCase());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const test = async () => {
    const normalized = call.trim().toUpperCase();
    if (busy || !/^[A-Z0-9/]{3,32}$/.test(normalized)) return;
    setBusy(true); setMessage("");
    try {
      const profile = await request("lookup_call", { call: normalized });
      const matchedProvider = profile.lookup_provider === "HamQTH" ? "HamQTH" : profile.lookup_provider === "QRZ" ? "QRZ" : provider;
      setMessage((profile.lookup_status ?? profile.qrz_status) === "matched"
        ? `${matchedProvider} matched ${profile.call}${profile.country ? ` · ${profile.country}` : ""}.`
        : String(profile.lookup_warning || `${matchedProvider} did not return an online match. Offline CTY data remains available.`));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : `${provider} lookup could not be completed. Offline CTY data remains available.`);
    } finally { setBusy(false); }
  };
  return <div className="service-credential">
    <label>{provider} test callsign<input aria-label={`${provider} test callsign`} value={call} maxLength={32}
      onChange={event => setCall(event.target.value.toUpperCase())} /></label>
    <button type="button" disabled={!applied || busy || !/^[A-Z0-9/]{3,32}$/.test(call.trim())} onClick={() => void test()}>{busy ? `Testing ${provider}…` : `Test ${provider} lookup`}</button>
    {!applied && <p className="service-credential-state" role="status">Save settings to apply {provider} before testing.</p>}
    {message && <p className="service-credential-state" role="status">{message}</p>}
  </div>;
}
