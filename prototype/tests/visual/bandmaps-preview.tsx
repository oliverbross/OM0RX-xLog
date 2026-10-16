// Synthetic, memory-only fixture. No worker, station, accounts or remote endpoints.
import React, { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BandMaps, type BandMapViewPreferences } from "../../src/live/BandMaps";
import "../../src/style.css";
import "../../src/live/live.css";
const params = new URLSearchParams(location.search);
const fontScale = params.get("font") === "2" ? 2 : 1;
const narrow = params.has("narrow"), crowded = params.has("crowded");
const calls = ["UB3A", "IU1PZC", "OK2JIQ/P", "R5GG", "UR2680YL", "SQ9GOL", ...(narrow ? ["VK8/OK2JIQ/PORTABLE"] : [])];
const spots = calls.map((callsign, index) => ({ id: `synthetic-${index}`, callsign, band: "20m", frequencyKHz: 14010 + index * 25,
  mode: "CW", country: "Synthetic location", source: "Synthetic fixture", comment: "Memory-only presentation data",
  callStatus: "New Callsign", dxccStatus: "Worked", statusHex: "#cc372d" }));
if (crowded) spots.push(...Array.from({ length: 60 }, (_, index) => ({ ...spots[index % calls.length], id: `crowded-${index}`, frequencyKHz: 14050 })));
function Preview() {
  const [preferences, setPreferences] = useState<BandMapViewPreferences>({ bands: narrow ? ["20m"] : ["20m", "40m"], followRadio: false, layout: "row", fontScale });
  const [selection, setSelection] = useState("");
  return <div className="app live synthetic-bandmaps" style={{ display: "flex", flexDirection: "column", height: "100dvh", minHeight: 0, padding: 12, width: narrow ? 330 : "100%", maxWidth: "100%" }}>
    <style>{".synthetic-bandmaps .band-maps { flex: 1; width: 100%; }"}</style>
    <p style={{ color: "var(--secondary)", margin: "0 0 8px" }}>Synthetic Band Maps · memory-only data</p>
    {selection && <p role="status">Synthetic selection: {selection}; no station command</p>}
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}><BandMaps compact spots={spots} preferences={preferences} onPreferencesChange={setPreferences} onSelect={spot => setSelection(spot.callsign)} /></div>
  </div>;
}
const host = document.getElementById("root") as HTMLElement & { fixtureRoot?: Root };
host.fixtureRoot ??= createRoot(host);
host.fixtureRoot.render(<Preview />);
