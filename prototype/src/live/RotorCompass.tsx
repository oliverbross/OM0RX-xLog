import { memo, useEffect, useState } from "react";
import "./RotorCompass.css";
const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 360;
export const bearingDelta = (from: number, to: number) => ((to - from + 540) % 360 + 360) % 360 - 180;
const point = (bearing: number, radius: number) => [100 + radius * Math.sin(bearing * Math.PI / 180), 100 - radius * Math.cos(bearing * Math.PI / 180)];
export function bearingArc(from: number, to: number) {
  const start = point(from, 83), end = point(to, 83), delta = bearingDelta(from, to);
  return Math.abs(delta) < .5 ? "" : `M ${start.join(" ")} A 83 83 0 0 ${delta >= 0 ? 1 : 0} ${end.join(" ")}`;
}
function RotorCompass({ connected, azimuth, target, path }: { connected: boolean; azimuth?: number | null; target?: number | null; path: "SP" | "LP" }) {
  const actual = connected && valid(azimuth) ? azimuth : null;
  const [reading, setReading] = useState({ actual, angle: actual ?? 0 });
  const angle = actual === null ? reading.angle : reading.actual === null ? actual : reading.angle + bearingDelta(reading.angle, actual);
  useEffect(() => { setReading(previous => ({ actual, angle: actual === null ? previous.angle : previous.actual === null ? actual : previous.angle + bearingDelta(previous.angle, actual) })); }, [actual]);
  return <svg className={`rotor-dial${actual === null ? " is-offline" : ""}`} viewBox="0 0 200 200" role="img"
    aria-label={actual !== null ? `Observed rotor bearing ${Math.round(actual)} degrees` : "Rotor bearing unavailable"}>
    <circle className="rotor-dial-bezel" cx="100" cy="100" r="96" />
    <circle className="rotor-dial-face" cx="100" cy="100" r="89" />
    {Array.from({ length: 72 }, (_, i) => <line key={i} className={i % 18 === 0 ? "rotor-tick-cardinal" : i % 6 === 0 ? "rotor-tick-major" : "rotor-tick"} x1="100" y1="14" x2="100" y2={i % 18 === 0 ? 27 : i % 6 === 0 ? 23 : 18} transform={`rotate(${i * 5} 100 100)`} />)}
    {["N", "E", "S", "W"].map((label, i) => { const [x, y] = point(i * 90, 63); return <text key={label} x={x} y={y} className={i === 0 ? "rotor-north" : "rotor-cardinal"}>{label}</text>; })}
    {[45, 135, 225, 315].map(value => { const [x, y] = point(value, 64); return <text key={value} className="rotor-degree" x={x} y={y}>{value}</text>; })}
    {actual !== null && valid(target) && <path className="rotor-target-arc" d={bearingArc(actual, target)} />}
    {valid(target) && <g transform={`rotate(${target} 100 100)`} aria-label={`${path} target bearing ${Math.round(target)} degrees`}><path className="rotor-target-marker" d="M 95 4 L 105 4 L 100 12 Z" /></g>}
    {actual !== null ? <g className="rotor-observed-needle" style={{ transform: `rotate(${angle}deg)` }}><path className="rotor-needle" d="M 100 29 L 105 98 L 100 105 L 95 98 Z" /><path className="rotor-counterweight" d="M 97 106 L 103 106 L 100 123 Z" /></g> : <text className="rotor-no-telemetry" x="100" y="117">NO TELEMETRY</text>}
    <circle className="rotor-dial-hub" cx="100" cy="100" r="7" /><circle className="rotor-dial-pin" cx="100" cy="100" r="2.5" />
  </svg>;
}
export default memo(RotorCompass);
