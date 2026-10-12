import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

type Data = Record<string, any>;
/** Keep the graphical surface stable while telemetry refreshes or disconnects. */
export default function Conditions({ propagation, request, weatherKey = "" }: { propagation: Data | null; request: (method: string) => Promise<any>; weatherKey?: string }) {
  const last = useRef<Data | null>(null);
  useEffect(() => { if (propagation?.bands?.length) last.current = propagation; }, [propagation]);
  const value = propagation?.bands?.length ? propagation : last.current;
  const [weather, setWeather] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refreshWeather = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false, pending = false;
    setWeather(null); setError(""); setBusy(false);
    const update = async () => {
      if (disposed || pending || !weatherKey) return;
      pending = true; setBusy(true);
      try {
        const next = await request("weather");
        if (!disposed) { setWeather(next); setError(""); }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error ? cause.message : "Weather unavailable");
      } finally { pending = false; if (!disposed) setBusy(false); }
    };
    refreshWeather.current = () => { void update(); };
    void update();
    const timer = setInterval(() => { void update(); }, 15 * 60_000);
    return () => { disposed = true; clearInterval(timer); };
  }, [request, weatherKey]);
  const color = (condition: string) => /good/i.test(condition) ? "#38d5a4" : /fair/i.test(condition) ? "#ffc269" : /poor/i.test(condition) ? "#ff716a" : "#607284";
  return <section className="live-conditions" aria-label="Propagation and local weather">
    <div><strong>HF propagation</strong><small>SFI {value?.solar_flux ?? "—"} · A {value?.a_index ?? "—"} · K {value?.k_index ?? "—"}</small></div>
    <div className="condition-bands">{(value?.bands?.length ? value.bands : ["80m–40m", "30m–20m", "17m–15m", "12m–10m"].map(name => ({ name, day: "Unknown", night: "Unknown" }))).map((band: Data) => <div key={band.name}><span>{band.name}</span><i style={{ background: color(band.day) }} title={`Day: ${band.day}`} aria-label={`Day: ${band.day}`} /><i style={{ background: color(band.night) }} title={`Night: ${band.night}`} aria-label={`Night: ${band.night}`} /></div>)}</div>
    <small className="condition-source"><span>{value?.updated_at ? `Updated ${new Date(value.updated_at * 1000).toLocaleTimeString()}` : "Awaiting propagation data"}{value?.stale || (!propagation?.bands?.length && value) ? " · last known" : ""}</span><span>Upper: day · lower: night · {value?.source || "N0NBH / HamQSL"}</span></small>
    <div className="condition-weather"><span>{weather ? `${weather.temperature_c}°C · ${weather.condition} · ${weather.wind_kmh} km/h` : busy ? "Loading station weather…" : "Station weather"}</span><button aria-label="Refresh weather" title={busy ? "Refreshing station weather" : "Refresh station weather"} disabled={busy || !weatherKey} onClick={() => refreshWeather.current()}><RefreshCw size={14} aria-hidden="true" /></button>{weather && <small>{weather.source || "Open-Meteo"} · {typeof weather.observed_at === "number" ? new Date(weather.observed_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Time unavailable"}{error ? " · last known" : ""}</small>}{error && <small role="status">{error}</small>}</div>
  </section>;
}
