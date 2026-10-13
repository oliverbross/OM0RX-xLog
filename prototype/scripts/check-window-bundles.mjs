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
for (const name of ["Awards", "Logbook", "Cluster"]) {
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
  assert(bytes <= 400_000, `${name} startup JavaScript exceeds the 400 kB budget: ${bytes}`);
  console.log(JSON.stringify({ window: name, bytes, gzip, files }));
}
