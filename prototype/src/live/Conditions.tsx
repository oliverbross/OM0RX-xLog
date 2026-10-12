import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

type Data = Record<string, any>;
/** Keep the graphical surface stable while telemetry refreshes or disconnects. */
export default function Conditions({ propagation, request, weatherKey = "", compact = false }: { propagation: Data | null; request: (method: string) => Promise<any>; weatherKey?: string; compact?: boolean }) {
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
  const stale = value?.stale || (!propagation?.bands?.length && value);
  const sourceTitle = `${value?.source || "N0NBH / HamQSL"}${value?.updated_at ? ` · ${new Date(value.updated_at * 1000).toLocaleString()}` : " · Awaiting propagation data"}${stale ? " · last known" : ""}`;
  return <section className={`live-conditions${compact ? " live-conditions-compact" : ""}`} aria-label="Propagation and local weather" title={sourceTitle}>
    <div className="condition-indices"><strong>HF propagation{stale && compact ? " · cached" : ""}</strong><small><span className="condition-sfi">SFI <b>{value?.solar_flux ?? "—"}</b></span> · <span className="condition-a">A <b>{value?.a_index ?? "—"}</b></span> · <span className="condition-k">K <b>{value?.k_index ?? "—"}</b></span></small></div>
    <div className="condition-bands">{(value?.bands?.length ? value.bands : ["80m–40m", "30m–20m", "17m–15m", "12m–10m", "6m"].map(name => ({ name, day: "Unknown", night: "Unknown" }))).map((band: Data) => <div key={band.name}><span>{band.name}</span><i style={{ background: color(band.day) }} title={`Day: ${band.day}`} aria-label={`Day: ${band.day}`} /><i style={{ background: color(band.night) }} title={`Night: ${band.night}`} aria-label={`Night: ${band.night}`} /></div>)}<div className="condition-periods"><span aria-hidden="true">&nbsp;</span><span>Day</span><span>Night</span></div></div>
    {!compact && <small className="condition-source"><span>{value?.updated_at ? `Updated ${new Date(value.updated_at * 1000).toLocaleTimeString()}` : "Awaiting propagation data"}{stale ? " · last known" : ""}</span><span>Upper: day · lower: night · {value?.source || "N0NBH / HamQSL"}</span></small>}
    <div className="condition-weather" title={weather ? `${weather.source || "Open-Meteo"} · ${weather.condition} · ${weather.wind_kmh} km/h${error ? " · last known" : ""}` : "Station weather"}><span>{weather ? compact ? `${weather.temperature_c}°C${error ? " · cached" : ""}` : `${weather.temperature_c}°C · ${weather.condition} · ${weather.wind_kmh} km/h` : busy ? compact ? "Weather…" : "Loading station weather…" : "Station weather"}</span><button aria-label="Refresh weather" title={busy ? "Refreshing station weather" : "Refresh station weather"} disabled={busy || !weatherKey} onClick={() => refreshWeather.current()}><RefreshCw size={14} aria-hidden="true" /></button>{weather && !compact && <small>{weather.source || "Open-Meteo"} · {typeof weather.observed_at === "number" ? new Date(weather.observed_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Time unavailable"}{error ? " · last known" : ""}</small>}{error && !compact && <small role="status">{error}</small>}</div>
  </section>;
}
