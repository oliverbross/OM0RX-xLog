import { useCallback, useEffect, useRef, useState } from "react";
import { Antenna } from "lucide-react";
import { HamlibDevice } from "./HamlibPanel";
import { rotorCommandParams, rotorProjection, validRotorSnapshot, type RotorOwner, type RotorSnapshot } from "./rotorControl";
import "./RotorPanel.css";

type Data = Record<string, any>;
type Request = (method: string, params?: Data) => Promise<Data>;
export default function RotorPanel({ snapshot, request, onManual }: { snapshot: RotorSnapshot | null; request: Request; onManual: () => void }) {
  const [owner, setOwner] = useState<RotorOwner>(() => snapshot?.owner ?? (localStorage.getItem("xlog.integration.rotor") === "hamlib" ? "hamlib" : "native_dcu1"));
  const [appliedOwner, setAppliedOwner] = useState(owner);
  const [hamlibOpened, setHamlibOpened] = useState(owner === "hamlib");
  const viewedOwner = useRef(owner); viewedOwner.current = owner;
  const applied = useRef(appliedOwner); applied.current = snapshot?.owner ?? appliedOwner;
  const browsed = useRef(false);
  const applying = useRef(false);
  const latest = useRef(snapshot); latest.current = snapshot;
  const [host, setHost] = useState(() => localStorage.getItem("xlog.rotor.host") || "");
  const [port, setPort] = useState(() => localStorage.getItem("xlog.rotor.port") || "4001");
  const [name, setName] = useState(() => localStorage.getItem("xlog.rotor.name") || "Rotor");
  const [bearing, setBearing] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const current = rotorProjection(snapshot);
  useEffect(() => { if (snapshot?.owner) { setAppliedOwner(snapshot.owner); if (!browsed.current) setOwner(snapshot.owner); if (snapshot.owner === "hamlib") setHamlibOpened(true); } }, [snapshot?.owner]);
  const run = async (operation: () => Promise<Data>, label: string) => {
    onManual(); setBusy(true); setError(""); setMessage("");
    try {
      const result = await operation();
      const backend = result?.backend;
      setMessage(backend?.accepted === true || backend?.state === "accepted" ? `${label} accepted; watch the observed bearing.` : `${label} completed.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Rotor operation failed."); }
    finally { setBusy(false); }
  };
  const applySelection = async () => {
    if (applied.current === owner || busy || applying.current) return;
    applying.current = true;
    const next = owner;
    await run(async () => {
      if (latest.current?.owner) {
        const departing = latest.current;
        const result = await request("rotor_disconnect", rotorCommandParams(departing));
        if (!validRotorSnapshot(result) || result.owner !== null || result.state !== "disconnected") throw new Error("Rotor retirement is unconfirmed. Keep the active selection and retry explicitly.");
        if (latest.current?.owner && (latest.current.owner !== departing.owner || latest.current.generation !== departing.generation)) throw new Error("Rotor owner changed during retirement. Review the active connection before applying.");
      }
      setAppliedOwner(next); applied.current = next;
      try { localStorage.setItem("xlog.integration.rotor", next); } catch { /* Connection remains usable without preference storage. */ }
      return {};
    }, "Rotor selection applied; connect the selected rotor explicitly");
    applying.current = false;
  };
  const hamlibRequest = useCallback(async (method: string, params: Data = {}) => {
    const { device: _device, ...config } = params;
    if (method === "hamlib_status") return { connected: latest.current?.owner === "hamlib" && rotorProjection(latest.current).connected, reconnect_required: latest.current?.owner === "hamlib" && latest.current?.state === "uncertain" };
    if (method === "hamlib_snapshot") return latest.current?.owner === "hamlib" ? latest.current.backend ?? {} : {};
    if (method === "hamlib_models" || method === "hamlib_serial_ports" || method === "hamlib_capabilities") return request(method, params);
    if (viewedOwner.current !== "hamlib" || applied.current !== "hamlib" || latest.current?.owner && latest.current.owner !== "hamlib") throw new Error("Apply the Hamlib rotor selection before changing its connection.");
    onManual();
    if (method === "hamlib_disconnect") return request("rotor_disconnect", rotorCommandParams(latest.current));
    if (method === "hamlib_connect" || method === "hamlib_reconnect") {
      if (method === "hamlib_reconnect" && latest.current?.owner) {
        const retired = await request("rotor_disconnect", rotorCommandParams(latest.current));
        if (!validRotorSnapshot(retired) || retired.owner !== null || retired.state !== "disconnected") throw new Error("Rotor retirement is unconfirmed; reconnect was not attempted.");
      }
      return request("rotor_connect", { owner: "hamlib", ...config });
    }
    throw new Error("Use the independent rotor motion controls below.");
  }, [request, onManual]);
  return <section className="live-station rotor-panel" aria-label="Independent rotor"><header className="live-station-head"><div><h2><Antenna size={17} /> Independent rotor</h2><p>Pair either rotor with the selected radio. Changing radios keeps this rotor connected.</p></div><span className={current.connected ? "teal" : "amber"}>{current.connected ? "Connected" : current.status}</span></header>
    <div className="live-actions" role="group" aria-label="Rotor connection type">{([ ["native_dcu1", "DCU-1 · TCP"], ["hamlib", "Local rotor · Hamlib"] ] as const).map(([id, label]) => <button key={id} disabled={busy} aria-pressed={owner === id} onClick={() => { browsed.current = true; setOwner(id); if (id === "hamlib") setHamlibOpened(true); }}>{label}</button>)}
      {owner !== (snapshot?.owner ?? appliedOwner) && <button type="button" disabled={busy} onClick={() => void applySelection()}>Apply rotor selection</button>}
      <span>Active rotor: {snapshot?.owner === "hamlib" ? "Hamlib" : snapshot?.owner === "native_dcu1" ? "DCU-1" : "Disconnected"}. {owner !== (snapshot?.owner ?? appliedOwner) ? "Viewing only. Apply to retire the active rotor; the radio stays connected." : "Connecting and motion require an explicit action."}</span></div>
    <div className="rotor-panel-layout"><div><div hidden={owner !== "hamlib"}>{hamlibOpened && <HamlibDevice device="rotor" request={hamlibRequest} state={snapshot?.owner === "hamlib" ? snapshot.backend : undefined} configurationOnly connectionOwned={!!snapshot?.owner} connectionSelectionAllowed={owner === "hamlib" && (snapshot?.owner ?? appliedOwner) === "hamlib" && !busy} />}</div><section hidden={owner !== "native_dcu1"} className="live-station-card"><h3>DCU-1 connection</h3><form className="live-station-connect" onSubmit={event => {
      event.preventDefault();
      if (viewedOwner.current !== "native_dcu1" || applied.current !== "native_dcu1" || latest.current?.owner) return;
      localStorage.setItem("xlog.rotor.host", host); localStorage.setItem("xlog.rotor.port", port); localStorage.setItem("xlog.rotor.name", name);
      void run(() => request("rotor_connect", { owner: "native_dcu1", host: host.trim(), port: Number(port), name: name.trim() }), "Rotor connection");
    }}><label>Rotor TCP host<input aria-label="Rotor TCP host" value={host} onChange={event => setHost(event.target.value)} /></label><label>Rotor TCP port<input aria-label="Rotor TCP port" type="number" min="1" max="65535" value={port} onChange={event => setPort(event.target.value)} /></label><label>Name<input aria-label="Rotor name" value={name} onChange={event => setName(event.target.value)} /></label>
      <div className="live-actions"><button disabled={busy || !!snapshot?.owner || appliedOwner !== "native_dcu1" || !host.trim() || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535 || !name.trim()}>Connect rotor</button><button type="button" disabled={busy || snapshot?.owner !== "native_dcu1"} onClick={() => void run(() => request("rotor_disconnect", rotorCommandParams(latest.current)), "Rotor disconnect")}>Disconnect rotor</button></div>
    </form></section></div>
    <section className="live-station-card"><h3>Observed antenna</h3><strong className="rotor-panel-bearing cyan">{typeof current.azimuth === "number" ? `${Math.round(current.azimuth).toString().padStart(3, "0")}°` : "—"}</strong><p>{current.name} · {current.status}</p>{current.target_label && <p>Target {current.target_label} · {current.target_bearing ?? "—"}°</p>}
      <form className="live-station-inline" onSubmit={event => { event.preventDefault(); if (bearing.trim() && Number.isFinite(Number(bearing)) && Number(bearing) >= 0 && Number(bearing) <= 360) void run(() => request("rotor_goto", rotorCommandParams(latest.current, { bearing: Number(bearing), label: "Manual bearing" })), "Rotor move"); }}><label>Bearing °<input aria-label="Rotor bearing degrees" type="number" min="0" max="360" value={bearing} onChange={event => setBearing(event.target.value)} /></label><button disabled={busy || !current.connected || !bearing.trim()}>Turn rotor</button><button type="button" disabled={!snapshot?.owner} onClick={() => void run(() => request("rotor_stop", rotorCommandParams(latest.current)), "Rotor stop")}>Stop rotor</button>{snapshot?.owner === "hamlib" && <button type="button" disabled={busy || !current.connected} onClick={() => void run(() => request("rotor_park", rotorCommandParams(latest.current)), "Rotor park")}>Park rotor</button>}</form>
      <p className="live-station-helper">Motion needs an explicit action. Stop requests motion release; disconnect closes the transport. No previous turn is replayed after reconnect.</p>
    </section></div>{error && <p className="live-station-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </section>;
}
