import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  BookOpen,
  LayoutDashboard,
  List,
  Map,
  Radio,
  Settings,
  Activity,
  Network,
  ExternalLink,
  CheckCircle2,
  RotateCcw,
  Search,
  Compass,
  FileText,
  FlaskConical,
  PanelLeft,
} from "lucide-react";
import WorldMap from "./Map";
import {
  bands,
  bandPosition,
  initialState,
  reducer,
  spots,
  spotOpportunity,
  type Band,
  type Draft,
  type Mode,
  type QSO,
  type Spot,
  type State,
} from "./model";
import { desktop, openMonitor, workerRequest } from "./worker";
import { startAcceptance } from "./acceptance";
import { clusterBatch, decodeClassifications, opportunityLabel, classificationTone, type Classification } from "./integration";
type View =
  | "Operator Desk"
  | "Logbook"
  | "World Map"
  | "Band Maps"
  | "DX Cluster"
  | "Station Control"
  | "Prototype Checks";
const navigation: { view: View; icon: typeof Radio }[] = [
  { view: "Operator Desk", icon: LayoutDashboard },
  { view: "Logbook", icon: BookOpen },
  { view: "World Map", icon: Map },
  { view: "Band Maps", icon: Activity },
  { view: "DX Cluster", icon: Network },
  { view: "Station Control", icon: Radio },
  { view: "Prototype Checks", icon: FlaskConical },
];
const query = new URLSearchParams(window.location.search);
const isMonitor = query.has("monitor") || query.get("view") === "monitor";
const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString("en-GB", {
    timeZone: "UTC",
    hour12: false,
  });

function BandMap({
  band,
  onSpot,
  selected,
  opportunity = spotOpportunity,
  tone = (spot: Spot) => spot.state,
}: {
  band: Band;
  onSpot: (s: Spot) => void;
  selected: string | null;
  opportunity?: (spot: Spot) => string;
  tone?: (spot: Spot) => string;
}) {
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState((bands[band].min + bands[band].max) / 2);
  const range = bands[band];
  const width = (range.max - range.min) / zoom;
  const min = Math.max(
    range.min,
    Math.min(range.max - width, center - width / 2),
  );
  const max = min + width;
  const filtered = spots.filter(
    (s) => s.band === band && s.mhz >= min && s.mhz <= max,
  );
  const pos = (f: number) => ((max - f) / width) * 100;
  return (
    <section className="band-panel" aria-label={`${band} frequency band map`}>
      <header>
        <strong>
          <i className="dot cyan" />
          {band}
        </strong>
        <span>
          {filtered.length} / {spots.filter((s) => s.band === band).length}{" "}
          spots
        </span>
        <button
          className="icon-button"
          aria-label={`Reset ${band} band map`}
          onClick={() => {
            setZoom(1);
            setCenter((range.min + range.max) / 2);
          }}
        >
          <RotateCcw size={13} />
        </button>
      </header>
      <div className="band-tools">
        <span>{zoom === 1 ? "Full band" : `${zoom}× zoom`}</span>
        <button
          aria-label={`Move ${band} higher`}
          onClick={() =>
            setCenter(Math.min(range.max - width / 2, center + width / 4))
          }
        >
          ↑
        </button>
        <button
          aria-label={`Move ${band} lower`}
          onClick={() =>
            setCenter(Math.max(range.min + width / 2, center - width / 4))
          }
        >
          ↓
        </button>
        <button
          aria-label={`Zoom out ${band}`}
          onClick={() => setZoom(Math.max(1, zoom - 1))}
        >
          −
        </button>
        <button
          aria-label={`Zoom in ${band}`}
          onClick={() => setZoom(Math.min(8, zoom + 1))}
        >
          +
        </button>
      </div>
      <div className="spectrum">
        <div
          className="allocation phone"
          style={{
            top: 0,
            height: `${Math.max(0, Math.min(100, pos(range.data)))}%`,
          }}
        >
          <span>PHONE</span>
        </div>
        <div
          className="allocation data"
          style={{
            top: `${Math.max(0, Math.min(100, pos(range.data)))}%`,
            height: `${Math.max(0, Math.min(100, pos(range.cw)) - Math.max(0, Math.min(100, pos(range.data))))}%`,
          }}
        >
          <span>DATA</span>
        </div>
        <div
          className="allocation cw"
          style={{
            top: `${Math.max(0, Math.min(100, pos(range.cw)))}%`,
            bottom: 0,
          }}
        >
          <span>CW</span>
        </div>
        {Array.from({ length: 9 }, (_, i) => (
          <div
            key={i}
            className="frequency-rule"
            style={{ top: `${i * 12.5}%` }}
          >
            <span>{(max - (width * i) / 8).toFixed(3)}</span>
          </div>
        ))}
        {filtered.map((s, i) => (
          <button
            className={`band-spot ${tone(s)} ${selected === s.id ? "selected" : ""}`}
            style={{
              top: `${pos(s.mhz)}%`,
              left: `${i % 2 === 0 ? "14" : "56"}%`,
            }}
            key={s.id}
            onClick={() => onSpot(s)}
            aria-label={`Load ${s.call} ${(s.mhz * 1000).toFixed(1)} kHz ${s.mode}, synthetic ${opportunity(s)}`}
            title={`${s.mhz.toFixed(6)} MHz · synthetic opportunity ${opportunity(s)}`}
          >
            <b>{s.call}</b>
            <span className="opportunity">{opportunity(s)}</span>
          </button>
        ))}
      </div>
      <footer>
        <span className="cyan">CW</span>
        <span className="pink">Data</span>
        <span className="amber">Phone</span>
        <span>
          {min.toFixed(3)}–{max.toFixed(3)} MHz
        </span>
      </footer>
    </section>
  );
}
function StationPulse({
  state,
  onMonitor,
  monitorLabel,
}: {
  state: State;
  onMonitor: () => void;
  monitorLabel?: string;
}) {
  return (
    <section className="panel pulse">
      <h2>
        <Activity size={15} /> Station pulse
      </h2>
      <dl>
        <dt>
          <i className="dot cyan" />
          Radio
        </dt>
        <dd>{state.profile === "simulator" ? "Simulated" : "Not connected"}</dd>
        <dt>
          <i className="dot teal" />
          Cluster
        </dt>
        <dd>{spots.length} synthetic spots</dd>
        <dt>
          <i className="dot amber" />
          Wavelog
        </dt>
        <dd>Sync off</dd>
        <dt>Logbook</dt>
        <dd>{state.qsos.length} session QSOs</dd>
      </dl>
      {monitorLabel !== "none" && (
        <button onClick={onMonitor}>
          <ExternalLink size={13} />{" "}
          {monitorLabel ?? (desktop ? "Detach monitor" : "Monitor preview")}
        </button>
      )}
    </section>
  );
}
function Intelligence({ state }: { state: State }) {
  const call = state.draft.call.trim();
  const spot = spots.find((s) => s.call === call);
  const previous = state.qsos.filter((q) => q.call === call);
  return (
    <section className="panel intelligence">
      <h2>
        <Search size={15} /> Callsign intelligence
      </h2>
      <div className="identity">
        <strong>
          {call
            ? (spot?.country ?? "Manual callsign · no lookup provider")
            : "Select a synthetic spot or enter a callsign"}
        </strong>
        <span className="teal">{previous.length} SESSION WORKED</span>
      </div>
      <span className="secondary">
        {spot?.grid ?? "No external callsign lookup in P1"}
      </span>
      <div className="band-history">
        {["80m", "40m", "20m", "17m", "15m", "10m"].map((b) => (
          <div key={b}>
            <span>{b}</span>
            <span>
              {previous.some(
                (q) => spots.find((s) => s.call === q.call)?.band === b,
              ) ? (
                <CheckCircle2 size={14} className="teal" />
              ) : (
                "—"
              )}
            </span>
          </div>
        ))}
      </div>
      <p className="secondary">
        {previous.length
          ? `Last session QSO · ${formatTime(previous[0].time)} UTC · ${previous[0].mode}`
          : "Synthetic context only · QRZ / awards not connected"}
      </p>
    </section>
  );
}
function QSOTable({ qsos }: { qsos: QSO[] }) {
  const [filter, setFilter] = useState("");
  const rows = qsos.filter(
    (q) =>
      q.call.includes(filter.toUpperCase()) ||
      q.comment.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <section className="logbook">
      <div className="section-toolbar">
        <h2>Session logbook</h2>
        <label className="search">
          <Search size={14} />
          <input
            aria-label="Search session QSOs"
            placeholder="Search callsign or comment"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </label>
        <span className="secondary">
          Memory only · clears when main window closes
        </span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>UTC</th>
              <th>Callsign</th>
              <th>MHz</th>
              <th>Mode</th>
              <th>Sent</th>
              <th>Received</th>
              <th>Profile</th>
              <th>Comment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.id}>
                <td>{formatTime(q.time)}</td>
                <td className="teal mono">{q.call}</td>
                <td className="cyan mono">{Number(q.frequency).toFixed(6)}</td>
                <td>{q.mode}</td>
                <td>{q.sent}</td>
                <td>{q.received}</td>
                <td>{q.profile}</td>
                <td>{q.comment}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className="empty">
            {qsos.length
              ? "No session contacts match this search."
              : "No session QSOs yet. Load a synthetic cluster spot, then log the contact."}
          </p>
        )}
      </div>
    </section>
  );
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [monitorState, setMonitorState] = useState<State>(initialState);
  const [view, setView] = useState<View>("Operator Desk");
  const [activeBand, setActiveBand] = useState<Band>("40m");
  const [clusterFilter, setClusterFilter] = useState("All bands");
  const [clusterSearch, setClusterSearch] = useState("");
  const [workerStatus, setWorkerStatus] = useState(
    desktop
      ? "Checking Swift worker…"
      : "Browser preview · Swift worker unavailable",
  );
  const [checkResult, setCheckResult] = useState("");
  const [checking, setChecking] = useState(false);
  const [classifications, setClassifications] = useState<Record<string, Classification>>({});
  const [clusterStatus, setClusterStatus] = useState(desktop ? "Classifying synthetic session…" : "Browser preview · fixed fixture labels");
  const [classificationRetry, setClassificationRetry] = useState(0);
  const opportunity = (spot: Spot): string => desktop ? opportunityLabel(classifications[spot.id]) : spotOpportunity(spot);
  const tone = (spot: Spot): string => desktop ? classificationTone(classifications[spot.id]) : spot.state;
  const [message, setMessage] = useState("");
  const [sidebar, setSidebar] = useState(true);
  const callsignRef = useRef<HTMLInputElement>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const current = isMonitor ? monitorState : state;
  useEffect(() => {
    if (!desktop || isMonitor) return;
    let active = true;
    setClassifications({});
    setClusterStatus("Classifying synthetic session…");
    workerRequest("cluster_classify", clusterBatch(state.qsos))
      .then(response => {
        const rows = decodeClassifications(response.result);
        if (active) {
          setClassifications(rows);
          setClusterStatus(`xCluster rules · ${state.qsos.length} synthetic session QSOs`);
        }
      })
      .catch(() => {
        if (active) setClusterStatus("Classification unavailable · retry or check the worker");
      });
    return () => { active = false; };
  }, [state.qsos, classificationRetry]);
  useEffect(() => {
    if (desktop) startAcceptance(isMonitor);
  }, []);
  useEffect(() => {
    const channel = new BroadcastChannel("xlog-p1-synthetic-monitor");
    channelRef.current = channel;
    channel.onmessage = (e) => {
      if (e.data?.type === "snapshot" && isMonitor)
        setMonitorState(e.data.state);
      if (e.data?.type === "request" && !isMonitor)
        channel.postMessage({ type: "snapshot", state });
    };
    if (isMonitor) channel.postMessage({ type: "request" });
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [state]);
  useEffect(() => {
    if (!isMonitor)
      channelRef.current?.postMessage({ type: "snapshot", state });
  }, [state]);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    workerRequest("health")
      .then((result) => {
        if (active) {
          setWorkerStatus(
            "Swift worker responded · details in Prototype Checks",
          );
          setCheckResult(JSON.stringify(result, null, 2));
        }
      })
      .catch((e) => {
        if (active) setWorkerStatus(`Worker unavailable · ${String(e)}`);
      });
    return () => {
      active = false;
    };
  }, []);
  const onSpot = useCallback(
    (spot: Spot) => {
      dispatch({ type: "spot", spot });
      setActiveBand((spot.band in bands ? spot.band : "40m") as Band);
      if (view === "DX Cluster") setView("Operator Desk");
      setTimeout(() => callsignRef.current?.focus(), 0);
    },
    [view],
  );
  const log = useCallback(() => {
    dispatch({
      type: "log",
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
    });
    callsignRef.current?.focus();
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        if (!isMonitor) log();
      }
      if (e.key === "Escape" && !isMonitor) {
        dispatch({ type: "clear" });
        callsignRef.current?.focus();
      }
      if (e.key === "F2" && !isMonitor) {
        e.preventDefault();
        setView("Operator Desk");
        setTimeout(() => callsignRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [log]);
  async function monitor() {
    try {
      setMessage(await openMonitor());
    } catch (e) {
      setMessage(String(e));
    }
  }
  async function check(method: string) {
    setChecking(true);
    try {
      const result = await workerRequest(
        method,
        method === "parse_adif"
          ? {
              text: "<ADIF_VER:5>3.1.7<EOH><CALL:4>W1AW<QSO_DATE:8>20261012<TIME_ON:6>120000<BAND:3>20m<MODE:3>SSB<FREQ:6>14.240<COMMENT:17>Synthetic fixture<APP_XLOG_TEST:7>fixture<EOR>",
            }
          : {},
      );
      setCheckResult(JSON.stringify(result, null, 2));
      if (method === "health")
        setWorkerStatus("Swift worker responded · details in Prototype Checks");
    } catch (e) {
      setCheckResult(String(e));
      if (method === "health")
        setWorkerStatus("Worker unavailable · see check result");
    } finally {
      setChecking(false);
    }
  }
  const field = (name: keyof Draft, value: string) =>
    dispatch({ type: "field", field: name, value });
  const qso = (e: FormEvent) => {
    e.preventDefault();
    log();
  };
  const filteredSpots = spots.filter(
    (s) =>
      (clusterFilter === "All bands" || s.band === clusterFilter) &&
      (s.call.includes(clusterSearch.toUpperCase()) ||
        s.country.toLowerCase().includes(clusterSearch.toLowerCase())),
  );
  if (isMonitor)
    return (
      <div className="monitor-app">
        <header className="monitor-title">
          <Radio size={18} />
          <h1>OM0RX-xLog · Station monitor</h1>
          <span className="simulation-tag">SIMULATION</span>
        </header>
        <div className="monitor-readback">
          <span className="secondary">
            {current.profile === "simulator"
              ? "SIMULATED RADIO"
              : "MANUAL · DISCONNECTED"}
          </span>
          <strong>
            {current.radio.mhz.toFixed(6)} <small>MHz</small>
          </strong>
          <span>
            {current.radio.mode} · {current.draft.call || "No active callsign"}
          </span>
        </div>
        <div className="monitor-details">
          <StationPulse
            state={current}
            monitorLabel="none"
            onMonitor={() => window.close()}
          />
          <div className="panel">
            <h2>
              <Compass size={15} />
              Station profile
            </h2>
            <p>
              {current.profile === "simulator"
                ? "Synthetic station · shared session snapshot"
                : "Manual / disconnected"}
            </p>
            <p className="secondary">
              No radio, rotor, amplifier, tuner or sync connection. Monitor
              follows main window session.
            </p>
          </div>
        </div>
        <div className="monitor-map">
          <WorldMap selected={current.selected} />
        </div>
        <footer className="status-line">
          P2 prototype ·{" "}
          {desktop ? "Desktop detached window" : "Browser preview"} · no
          hardware IO
        </footer>
      </div>
    );
  return (
    <div className={`app ${sidebar ? "" : "sidebar-collapsed"}`}>
      <header className="station-rail">
        <button
          className="icon-button sidebar-toggle"
          onClick={() => setSidebar(!sidebar)}
          aria-label="Toggle sidebar"
        >
          <PanelLeft size={17} />
        </button>
        <div className="brand">
          <BookOpen size={17} />
          <strong>OM0RX-xLog</strong>
        </div>
        <div className="rail-item">
          <Radio size={16} />
          <span>
            <small>RADIO · SIMULATION</small>
            <b>
              {state.profile === "simulator"
                ? `${state.radio.mode} · ${state.radio.mhz.toFixed(6)} MHz`
                : "Manual / disconnected"}
            </b>
          </span>
        </div>
        <div className="rail-item">
          <Network size={16} />
          <span>
            <small>CLUSTER · FIXTURE</small>
            <b>{spots.length} synthetic spots</b>
          </span>
        </div>
        <div className="rail-item">
          <RotateCcw size={15} />
          <span>
            <small>WAVELOG</small>
            <b>Sync off</b>
          </span>
        </div>
        <div className="rail-end">
          <span className="simulation-tag">P2 SIMULATION</span>
          <b>{state.qsos.length} session QSOs</b>
        </div>
      </header>
      <aside className="sidebar">
        <span className="nav-group">Station log</span>
        <nav aria-label="Workspaces">
          {navigation.map(({ view: v, icon: Icon }) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-current={view === v ? "page" : undefined}
            >
              <Icon size={19} />
              <span>{v}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <b className="teal">Synthetic session</b>
          <span>No credentials · no hardware</span>
          <span>Installed apps unchanged</span>
        </div>
      </aside>
      <main>
        <div className="workspace-heading">
          <h1>{view}</h1>
          <label className="profile-selector">
            Station profile{" "}
            <select
              aria-label="Station profile"
              value={state.profile}
              onChange={(e) =>
                dispatch({
                  type: "profile",
                  profile: e.target.value as State["profile"],
                })
              }
            >
              <option value="simulator">Simulator · no hardware</option>
              <option value="manual">Manual / disconnected</option>
            </select>
          </label>
        </div>
        {(view === "Operator Desk" || view === "Station Control") && (
          <div className="desk-top">
            <section className="panel active-qso">
              <h2>
                <Radio size={15} /> Active QSO{" "}
                <span className="secondary">Synthetic · session memory</span>
              </h2>
              <form onSubmit={qso}>
                <div className="qso-first">
                  <label className="callsign">
                    CALLSIGN
                    <input
                      ref={callsignRef}
                      autoFocus
                      autoComplete="off"
                      value={state.draft.call}
                      placeholder="W1AW"
                      onChange={(e) => field("call", e.target.value)}
                      aria-label="Callsign"
                    />
                  </label>
                  <label>
                    FREQUENCY MHz
                    <input
                      aria-label="Frequency MHz"
                      inputMode="decimal"
                      value={state.draft.frequency}
                      onChange={(e) => field("frequency", e.target.value)}
                    />
                  </label>
                  <label>
                    MODE
                    <select
                      aria-label="Mode"
                      value={state.draft.mode}
                      onChange={(e) => field("mode", e.target.value as Mode)}
                    >
                      {(["SSB", "CW", "FT8"] as Mode[]).map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="qso-second">
                  <input
                    aria-label="Contact name"
                    placeholder="Contact name"
                    value={state.draft.name}
                    onChange={(e) => field("name", e.target.value)}
                  />
                  <input
                    aria-label="Comment or spot note"
                    placeholder="Comment / spot note"
                    value={state.draft.comment}
                    onChange={(e) => field("comment", e.target.value)}
                  />
                  <input
                    aria-label="RST sent"
                    value={state.draft.sent}
                    onChange={(e) => field("sent", e.target.value)}
                  />
                  <input
                    aria-label="RST received"
                    value={state.draft.received}
                    onChange={(e) => field("received", e.target.value)}
                  />
                </div>
                <div className="qso-actions">
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "read" })}
                    disabled={state.profile === "manual"}
                  >
                    <Radio size={13} /> Read simulated radio
                  </button>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: "clear" })}
                  >
                    Clear draft <kbd>Esc</kbd>
                  </button>
                  <button className="primary" type="submit">
                    <CheckCircle2 size={15} /> Log QSO <kbd>⌘ / Ctrl ↵</kbd>
                  </button>
                </div>
              </form>
              {state.error && (
                <p className="error" role="alert">
                  {state.error}
                </p>
              )}
            </section>
            <Intelligence state={state} />
            <StationPulse state={state} onMonitor={monitor} />
          </div>
        )}
        {(view === "Operator Desk" || view === "World Map") && (
          <div
            className={`desk-maps ${view === "World Map" ? "world-only" : ""}`}
          >
            <section className="map-section">
              <div className="section-toolbar">
                <h2>World map</h2>
                <span className="secondary">Offline DXCC polygons</span>
                <span className="cyan">{spots.length} mapped</span>
                <button
                  onClick={() =>
                    setView(
                      view === "World Map" ? "Operator Desk" : "World Map",
                    )
                  }
                >
                  <Map size={13} />
                  {view === "World Map" ? "Operator desk" : "Expand map"}
                </button>
              </div>
              <WorldMap selected={state.selected} onSpot={onSpot} />
            </section>
            {view === "Operator Desk" && (
              <section className="band-section">
                <div className="section-toolbar">
                  <h2>Band maps</h2>
                  <select
                    aria-label="Selected band map"
                    value={activeBand}
                    onChange={(e) => setActiveBand(e.target.value as Band)}
                  >
                    {Object.keys(bands).map((b) => (
                      <option key={b}>{b}</option>
                    ))}
                  </select>
                  <button
                    aria-label="Show all band maps"
                    onClick={() => setView("Band Maps")}
                  >
                    <ExternalLink size={13} />
                  </button>
                </div>
                <BandMap
                  band={activeBand}
                  onSpot={onSpot}
                  selected={state.selected}
                  opportunity={opportunity}
                  tone={tone}
                />
              </section>
            )}
          </div>
        )}
        {view === "Band Maps" && (
          <>
            <p className="secondary view-note">
              Synthetic spots · select a callsign to load the draft and tune the
              simulator. Frequencies positioned within each band.
            </p>
            <div className="band-grid">
              {(Object.keys(bands) as Band[]).map((b) => (
                <BandMap
                  key={b}
                  band={b}
                  onSpot={onSpot}
                  selected={state.selected}
                  opportunity={opportunity}
                  tone={tone}
                />
              ))}
            </div>
          </>
        )}
        {view === "Logbook" && <QSOTable qsos={state.qsos} />}
        {view === "DX Cluster" && (
          <section className="cluster">
            <div className="section-toolbar">
              <h2>
                <Network size={15} /> Integrated DX Cluster
              </h2>
              <span className="simulation-tag">SYNTHETIC FEED</span>
              <select
                aria-label="Cluster band filter"
                value={clusterFilter}
                onChange={(e) => setClusterFilter(e.target.value)}
              >
                {["All bands", "40m", "20m", "15m"].map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
              <input
                aria-label="Search cluster spots"
                placeholder="Callsign / country"
                value={clusterSearch}
                onChange={(e) => setClusterSearch(e.target.value)}
              />
            </div>
            <p className="view-note secondary">
              Select a callsign or press Enter on its button to load the QSO
              draft. Simulator follows frequency and mode. Session labels: NC new call · NB new band · NM new mode · ATNO new entity · WKD worked.
              Native labels use the extracted xCluster rules. Browser preview uses fixed fixtures. No cluster socket is opened.
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Callsign</th>
                    <th>MHz</th>
                    <th>Band</th>
                    <th>Mode</th>
                    <th>Country</th>
                    <th>Reporter</th>
                    <th>Opportunity</th>
                    <th>Status</th>
                    <th>Spot note</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSpots.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <button
                          className="call-button"
                          onClick={() => onSpot(s)}
                        >
                          {s.call}
                        </button>
                      </td>
                      <td className="cyan mono">{s.mhz.toFixed(6)}</td>
                      <td>{s.band}</td>
                      <td>{s.mode}</td>
                      <td>{s.country}</td>
                      <td>{s.reporter}</td>
                      <td className="cyan mono">{opportunity(s)}</td>
                      <td
                        className={
                          tone(s) === "confirmed"
                            ? "teal"
                            : tone(s) === "worked"
                              ? "orange"
                              : tone(s) === "secondary" ? "secondary" : "cyan"
                        }
                      >
                        {desktop ? classifications[s.id]?.call_status ?? "Unknown" : s.state}
                      </td>
                      <td>{s.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredSpots.length === 0 && (
                <p className="empty">No synthetic spots match this filter.</p>
              )}
            </div>
            <div className="cluster-console">
              <h2>Fixture console</h2>
              <p role="status" data-cluster-classification={Object.keys(classifications).length === spots.length ? "ready" : "unavailable"}>{clusterStatus}</p>
              <button disabled={!desktop || clusterStatus.startsWith("Classifying")} onClick={() => setClassificationRetry(n => n + 1)}>Refresh classification</button>
              <pre>{`[P2] ${spots.length} synthetic spots · no network feed.\n[P2] Native parser and classification rules from xCluster.\n[P2] No live cluster, FLEX forwarding or compatibility listener.`}</pre>
            </div>
          </section>
        )}
        {view === "Station Control" && (
          <section className="station-detail">
            <h2>
              <Radio size={16} /> Simulated station readback
            </h2>
            <div className="radio-frequency">
              {state.profile === "simulator"
                ? state.radio.mhz.toFixed(6)
                : "Disconnected"}
              <small>{state.profile === "simulator" ? " MHz" : ""}</small>
            </div>
            <p>
              {state.profile === "simulator"
                ? `${state.radio.mode} · coherent fixture snapshot`
                : "Frequency entry remains available in the QSO draft."}
            </p>
            <dl className="capabilities">
              <dt>Radio transport</dt>
              <dd>
                {state.profile === "simulator"
                  ? "In-memory simulator"
                  : "Not configured"}
              </dd>
              <dt>Rotor</dt>
              <dd>Not integrated yet</dd>
              <dt>Accessories</dt>
              <dd>Not integrated yet</dd>
              <dt>PTT / CW / tune</dt>
              <dd>Unavailable in this prototype</dd>
              <dt>Provider generation</dt>
              <dd>One synthetic UI session</dd>
            </dl>
            <button onClick={monitor}>
              <ExternalLink size={14} />
              Open{" "}
              {desktop ? "detached station monitor" : "browser monitor preview"}
            </button>
          </section>
        )}
        {view === "Prototype Checks" && (
          <section className="checks">
            <h2>
              <FlaskConical size={16} /> Swift worker / IPC checks
            </h2>
            <p>{workerStatus}</p>
            <p className="secondary">
              The packaged desktop shell supervises the real Swift worker. These
              checks use synthetic ADIF only; no operator files, credentials or
              station connections.
            </p>
            <div className="check-actions">
              <button
                disabled={!desktop || checking}
                onClick={() => check("health")}
              >
                Check worker health
              </button>
              <button
                disabled={!desktop || checking}
                onClick={() => check("parse_adif")}
              >
                <FileText size={14} />
                Parse synthetic ADIF
              </button>
              <button
                disabled={!desktop || checking}
                onClick={() => check("self_test")}
              >
                Run worker self-test
              </button>
              <button disabled={!desktop || checking} onClick={() => check("integration_self_test")}>
                Check integration contracts
              </button>
            </div>
            {checking && <p role="status">Waiting for worker response…</p>}
            <pre className="check-output">
              {checkResult ||
                "Launch the desktop prototype to inspect worker responses. Browser preview cannot run the Swift worker."}
            </pre>
            <h2>Integration stage</h2>
            <p>
              Shared station contracts and xCluster parser/classification run in the Swift worker.
              Cluster and band-map labels reflect synthetic session contacts; they are not results from your real logbook.
            </p>
            <p className="secondary">
              The logbook above is synthetic session memory. Production
              database, ADIF storage, sync, QRZ, hardware control, imagery
              providers and full native screen parity await later gates.
            </p>
          </section>
        )}
        <footer className="status-line" aria-live="polite">
          <span className={state.error ? "error" : "teal"}>
            {state.error || message || state.notice}
          </span>
          <span className="secondary">
            F2 callsign · Esc clear · ⌘ / Ctrl Enter log
          </span>
        </footer>
      </main>
    </div>
  );
}
