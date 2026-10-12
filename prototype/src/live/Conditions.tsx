import { useEffect, useRef, useState } from "react";

type Data = Record<string, any>;
/** Keep the graphical surface stable while telemetry refreshes or disconnects. */
export default function Conditions({ propagation, request }: { propagation: Data | null; request: (method: string) => Promise<any> }) {
  const last = useRef<Data | null>(null);
  useEffect(() => { if (propagation?.bands?.length) last.current = propagation; }, [propagation]);
  const value = propagation?.bands?.length ? propagation : last.current;
  const [weather, setWeather] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const color = (condition: string) => /good/i.test(condition) ? "#38d5a4" : /fair/i.test(condition) ? "#ffc269" : /poor/i.test(condition) ? "#ff716a" : "#607284";
  return <section className="live-conditions" aria-label="Propagation and local weather">
    <div><strong>HF propagation</strong><small>SFI {value?.solar_flux ?? "—"} · A {value?.a_index ?? "—"} · K {value?.k_index ?? "—"}</small></div>
    <div className="condition-bands">{(value?.bands?.length ? value.bands : ["80m–40m", "30m–20m", "17m–15m", "12m–10m"].map(name => ({ name, day: "Unknown", night: "Unknown" }))).map((band: Data) => <div key={band.name}><span>{band.name}</span><i style={{ background: color(band.day) }} title={`Day: ${band.day}`} aria-label={`Day: ${band.day}`} /><i style={{ background: color(band.night) }} title={`Night: ${band.night}`} aria-label={`Night: ${band.night}`} /></div>)}</div>
    <small>{value?.updated_at ? `Updated ${new Date(value.updated_at * 1000).toLocaleTimeString()}` : "Awaiting propagation data"}{value?.stale || (!propagation?.bands?.length && value) ? " · last known" : ""}<br />Upper: day · lower: night · {value?.source || "N0NBH / HamQSL"}</small>
    <div className="condition-weather"><span>{weather ? `${weather.temperature_c}°C · ${weather.condition} · ${weather.wind_kmh} km/h` : "Station weather"}</span><button disabled={busy} onClick={() => { setBusy(true); setError(""); void request("weather").then(setWeather).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>{busy ? "Loading…" : "Refresh weather"}</button>{error && <small role="alert">{error}</small>}</div>
  </section>;
}
