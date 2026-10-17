import { memo, useEffect, useState } from "react";
import "./RotorCompass.css";
const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 360;
export const bearingDelta = (from: number, to: number) => ((to - from + 540) % 360 + 360) % 360 - 180;
const point = (bearing: number, radius: number) => [100 + radius * Math.sin(bearing * Math.PI / 180), 100 - radius * Math.cos(bearing * Math.PI / 180)];
export function bearingArc(from: number, to: number) {
  const start = point(from, 83), end = point(to, 83), delta = bearingDelta(from, to);
  return Math.abs(delta) < .5 ? "" : `M ${start.join(" ")} A 83 83 0 0 ${delta >= 0 ? 1 : 0} ${end.join(" ")}`;
}
type DialReadout = { call: string; distanceKm?: number; status?: string };
type PathControls = { shortBearing?: number | null; longBearing?: number | null; busy?: boolean;
  onSelect: (path: "SP" | "LP") => void };
function RotorCompass({ connected, azimuth, target, path, readout, pathControls }: { connected: boolean; azimuth?: number | null;
  target?: number | null; path: "SP" | "LP"; readout?: DialReadout; pathControls?: PathControls }) {
  const actual = connected && valid(azimuth) ? azimuth : null;
  const distance = typeof readout?.distanceKm === "number" && Number.isFinite(readout.distanceKm)
    ? `${Math.round(readout.distanceKm).toLocaleString()} km` : null;
  const [reading, setReading] = useState({ actual, angle: actual ?? 0 });
  const angle = actual === null ? reading.angle : reading.actual === null ? actual : reading.angle + bearingDelta(reading.angle, actual);
  useEffect(() => { setReading(previous => ({ actual, angle: actual === null ? previous.angle : previous.actual === null ? actual : previous.angle + bearingDelta(previous.angle, actual) })); }, [actual]);
  const dial = <svg className={`rotor-dial${actual === null ? " is-offline" : ""}${readout ? " has-readout" : ""}`} viewBox="0 0 200 200" role="img"
    aria-label={actual !== null ? `Observed rotor bearing ${Math.round(actual)} degrees` : "Rotor bearing unavailable"}>
    {readout && <desc>{`Target callsign ${readout.call || "unavailable"}. ${path} target ${valid(target) ? `${Math.round(target)} degrees` : "unavailable"}.${distance ? ` ${path} distance ${distance}.` : ""} ${readout.status || "Rotor telemetry unavailable"}.`}</desc>}
    <circle className="rotor-dial-bezel" cx="100" cy="100" r="96" />
    <circle className="rotor-dial-face" cx="100" cy="100" r="89" />
    {Array.from({ length: 72 }, (_, i) => <line key={i} className={i % 18 === 0 ? "rotor-tick-cardinal" : i % 6 === 0 ? "rotor-tick-major" : "rotor-tick"} x1="100" y1="14" x2="100" y2={i % 18 === 0 ? 27 : i % 6 === 0 ? 23 : 18} transform={`rotate(${i * 5} 100 100)`} />)}
    {["N", "E", "S", "W"].map((label, i) => { const [x, y] = point(i * 90, 63); return <text key={label} x={x} y={y} className={i === 0 ? "rotor-north" : "rotor-cardinal"}>{label}</text>; })}
    {[45, 135, 225, 315].map(value => { const [x, y] = point(value, 64); return <text key={value} className="rotor-degree" x={x} y={y}>{value}</text>; })}
    {actual !== null && valid(target) && <path className="rotor-target-arc" d={bearingArc(actual, target)} />}
    {valid(target) && <g transform={`rotate(${target} 100 100)`} aria-label={`${path} target bearing ${Math.round(target)} degrees`}><path className="rotor-target-marker" d="M 95 4 L 105 4 L 100 12 Z" /></g>}
    {actual !== null ? <g className="rotor-observed-needle" style={{ transform: `rotate(${angle}deg)` }}><path className="rotor-needle" d={readout ? "M 100 23 L 105 36 L 100 32 L 95 36 Z" : "M 100 29 L 105 98 L 100 105 L 95 98 Z"} />{!readout && <path className="rotor-counterweight" d="M 97 106 L 103 106 L 100 123 Z" />}</g> : !readout && <text className="rotor-no-telemetry" x="100" y="117">NO TELEMETRY</text>}
    {readout ? <g className="rotor-dial-readout">
      <text className="rotor-readout-call" x="100" y="66" fontSize={readout.call.length > 16 ? 6 : readout.call.length > 10 ? 9 : 12}>{readout.call || "—"}</text>
      <text className="rotor-readout-observed" x="100" y="90">{actual !== null ? `${Math.round(actual).toString().padStart(3, "0")}°` : "---°"}</text>
      <text className="rotor-readout-label" x="100" y="108">{actual !== null ? "OBSERVED" : "NO TELEMETRY"}</text>
      <text className="rotor-readout-target" x="100" y="126">{path} {valid(target) ? `${Math.round(target)}°` : "---°"} TARGET</text>
      {distance && <text className="rotor-readout-distance" x="100" y="141">{distance}</text>}
    </g> : <><circle className="rotor-dial-hub" cx="100" cy="100" r="7" /><circle className="rotor-dial-pin" cx="100" cy="100" r="2.5" /></>}
  </svg>;
  if (!pathControls) return dial;
  return <div className="rotor-dial-shell">{dial}<div className="rotor-path-controls">
    <button type="button" aria-label="Turn rotor short path" aria-pressed={path === "SP"}
      disabled={pathControls.busy || !connected || !valid(pathControls.shortBearing)} onClick={() => pathControls.onSelect("SP")}>SP{valid(pathControls.shortBearing) ? ` · ${Math.round(pathControls.shortBearing)}°` : ""}</button>
    <button type="button" aria-label="Turn rotor long path" aria-pressed={path === "LP"}
      disabled={pathControls.busy || !connected || !valid(pathControls.longBearing)} onClick={() => pathControls.onSelect("LP")}>LP{valid(pathControls.longBearing) ? ` · ${Math.round(pathControls.longBearing)}°` : ""}</button>
  </div></div>;
}
export default memo(RotorCompass);
