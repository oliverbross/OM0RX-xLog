// Production graph gate: detached data windows must not pull in the main radio/map UI.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import assert from "node:assert/strict";
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(dist, ".vite/manifest.json"), "utf8"));
function closure(key, found = new Set()) {
  if (found.has(key)) return found;
  assert(manifest[key], `Missing build entry ${key}`);
  found.add(key);
  for (const dependency of manifest[key].imports ?? []) closure(dependency, found);
  return found;
}
const main = "src/LiveApp.tsx";
assert(manifest[main], "Main workspace bundle is missing");
const eagerGraph = closure("index.html");
const eagerCss = new Set([...eagerGraph].flatMap(key => manifest[key].css ?? []));
const setupDialogEntry = "src/contesting/DetachedContestSetupDialog.tsx";
assert(manifest[setupDialogEntry], "Detached setup dialogs are missing");
const setupDialogGraph = closure(setupDialogEntry, closure("index.html"));
assert(!setupDialogGraph.has(main), "Setup dialogs import the main station workspace");
assert(!setupDialogGraph.has("src/contesting/DetachedContestSetupSurface.tsx"), "Setup dialogs import the session mutation owner");
// Maps are explicit child entries too. World Map legitimately owns MapLibre;
// Band Maps must not pay for it or import the main station controller.
for (const name of ["WorldMap", "BandMaps", "Monitor"]) {
  const entry = `src/live/Detached${name}Surface.tsx`;
  const graph = closure(entry, closure("index.html"));
  assert(!graph.has(main), `${name} imports the main station workspace`);
  if (name === "BandMaps") assert(!graph.has("src/Map.tsx"), "Band Maps imports World Map");
  const lateCss = [...graph].flatMap(key => manifest[key].css ?? []).filter(file => !eagerCss.has(file));
  assert.equal(lateCss.length, 0, `${name} loads late CSS after shared overrides: ${lateCss.join(", ")}`);
  const files = [...new Set([...graph].map(key => manifest[key].file))];
  const data = files.map(file => readFileSync(resolve(dist, file)));
  const bytes = data.reduce((sum, item) => sum + item.length, 0);
  assert(bytes <= (name === "BandMaps" ? 400_000 : 1_600_000), `${name} startup JavaScript budget exceeded: ${bytes}`);
  console.log(JSON.stringify({ window: name, bytes, gzip: data.reduce((sum, item) => sum + gzipSync(item).length, 0), files }));
}
for (const name of ["Awards", "Logbook", "Cluster", "QSO", "SpotHistory", "CallsignIntelligence", "PreviousQSOs", "OperatingGoals", "Settings", "Opportunities", "HFPropagationLive", "StationControl", "CW", "Rotor", "StationStatus", "Propagation", "StationIdentity", "Alerts", "Antenna"]) {
  const entry = `src/live/Detached${name}Surface.tsx`;
  const graph = closure(entry, closure("index.html"));
  assert(!graph.has(main), `${name} imports the main station workspace`);
  assert(!graph.has("src/Map.tsx"), `${name} imports the map UI`);
  const lateCss = [...graph].flatMap(key => manifest[key].css ?? []).filter(file => !eagerCss.has(file));
  assert.equal(lateCss.length, 0, `${name} loads late CSS after shared overrides: ${lateCss.join(", ")}`);
  const files = [...new Set([...graph].map(key => manifest[key].file))];
  const data = files.map(file => readFileSync(resolve(dist, file)));
  const bytes = data.reduce((sum, item) => sum + item.length, 0);
  const gzip = data.reduce((sum, item) => sum + gzipSync(item).length, 0);
  // QSO and Settings share validated cross-window field visibility; QSO also
  // applies the mode-aware 59/599 defaults in every editor. Settings owns the
  // persisted propagation cadence. The heavier canvas editor remains outside
  // both detached surfaces.
  // Contest Setup adds one lazy route to the shared surface loader without
  // pulling its contest workspace into ordinary detached-window startup.
  // Three additional lazy setup-dialog routes add preload metadata to the shared
  // bootstrap. Their setup UI and session owner remain outside this startup
  // graph. Keep the adjustment local to the affected budget.
  const budget = name === "Settings" ? 408_000 : name === "QSO" ? 407_000 : name === "Logbook" ? 402_000 : 401_000;
  assert(bytes <= budget, `${name} startup JavaScript exceeds the ${budget / 1_000} kB budget: ${bytes}`);
  console.log(JSON.stringify({ window: name, bytes, gzip, files }));
}
