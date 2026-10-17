import { useState } from "react";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<Data>;

export default function QRZLookupTest({ request, defaultCall }: { request: Request; defaultCall: string }) {
  const [call, setCall] = useState(defaultCall.trim().toUpperCase());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const test = async () => {
    const normalized = call.trim().toUpperCase();
    if (busy || !/^[A-Z0-9/]{3,32}$/.test(normalized)) return;
    setBusy(true); setMessage("");
    try {
      const profile = await request("lookup_call", { call: normalized });
      setMessage(profile.qrz_status === "matched"
        ? `QRZ matched ${profile.call}${profile.country ? ` · ${profile.country}` : ""}.`
        : String(profile.lookup_warning || "QRZ did not return an online match. Offline CTY data remains available."));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "QRZ lookup could not be completed. Offline CTY data remains available.");
    } finally { setBusy(false); }
  };
  return <div className="service-credential">
    <label>QRZ test callsign<input aria-label="QRZ test callsign" value={call} maxLength={32}
      onChange={event => setCall(event.target.value.toUpperCase())} /></label>
    <button type="button" disabled={busy || !/^[A-Z0-9/]{3,32}$/.test(call.trim())} onClick={() => void test()}>{busy ? "Testing QRZ…" : "Test QRZ lookup"}</button>
    {message && <p className="service-credential-state" role="status">{message}</p>}
  </div>;
}
