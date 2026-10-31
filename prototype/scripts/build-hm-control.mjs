// Reproducible adapter around Billy NZ3C's pinned, unmodified upstream source.
// The originals and MIT notice are retained under vendor/ham-mission-control.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url));
const source = await readFile(`${root}vendor/ham-mission-control/index.html`, "utf8");
const assets = JSON.parse(await readFile(`${root}vendor/ham-mission-control/ASSETS.json`, "utf8"));
for (const asset of assets) {
  const bytes = await readFile(`${root}public/hm-control-assets/${asset.name}`);
  if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256)
    throw new Error(`HM Control asset does not match its recorded provenance: ${asset.name}`);
}
const output = `${root}hm-control/`;
await mkdir(output, { recursive: true });
let js = source.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const replace = (before, after) => {
  if (!js.includes(before)) throw new Error(`HM Control upstream changed: ${before.slice(0, 70)}`);
  js = js.replace(before, after);
};
const section = (start, end, body) => {
  const a = js.indexOf(start), b = js.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`HM Control section missing: ${start}`);
  js = js.slice(0, a) + body + "\n\n" + js.slice(b);
};
js = `// Derived from Billy NZ3C Ham Mission Control; MIT (see vendor notice).\nimport * as d3 from 'd3';\nimport * as topojson from 'topojson-client';\nimport * as satellite from 'satellite.js';\nimport mqtt from 'mqtt';\nimport { connectXLog, publicFetch, updateCluster, announceLogChanges } from './xlog-adapter.js';\nconst LINK = await connectXLog();\nconst fetch = (url, options) => publicFetch(LINK, url, options);\n` + js;
section("const SETTINGS = {", "const SATS =", `const EMBED = false;\nconst CFG = { ...LINK.home, relay: '' };\nconst HOME = { ...LINK.home, name: LINK.home.town };`);
section("// Made-up contacts until", "// ---------- Fit", "");
replace('const IMG = "https://unpkg.com/three-globe@2.31.0/example/img/";', 'const IMG = "/hm-control-assets/";');
replace('"https://unpkg.com/globe.gl@2.34.4/example/clouds/clouds.png"', 'IMG + "clouds.png"');
replace('"https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json"', '"/hm-control-assets/countries-110m.json"');
section("let QSOS = EMBED ?", "const qsoGroup =", "let QSOS = LINK.initial.log.logbook.points, isSample = false;");
replace("  qsoGroup.clear();", "  qsoGroup.traverse(object => { if (object !== qsoGroup) { object.geometry?.dispose(); object.material?.dispose(); } });\n  qsoGroup.clear();");
section("// ---------- ADIF import:", "// ---------- Weather", "// Contacts come only from the authoritative xLog logbook.");
section("// ---------- DX cluster (HamQTH)", "// =====================================================================\n// RELAY", `// Shared xLog cluster, with the same report coordinates and freshness.\nlet tickerHtml = '';\nfunction loadSpots() {\n  updateCluster(LINK.current.context, { $, blips, blipXY, esc });\n}`);
section("async function pollRelay()", "// =====================================================================\n// RENDER LOOP", `// xLog owns the rig and all contact writes. There is no relay or demo rig.\nshowRig(null);\nlet priorLog = LINK.initial.log;\nLINK.subscribe(value => {\n  const next = value.log;\n  if (next.generation !== priorLog.generation || next.logbook.revision !== priorLog.logbook.revision) {\n    QSOS = next.logbook.points; drawQsos(); refreshQsoBlips();\n    announceLogChanges(priorLog, next, handleEvent); priorLog = next;\n  }\n  showRig(value.rig);\n  $('onAir').textContent = value.rig?.tx === true ? 'ON AIR' : value.rig?.tx === false ? 'RX' : 'PTT UNKNOWN';\n  loadSpots();\n});\naddEventListener('keydown', e => {\n  if (e.code === 'Space' && !e.target.closest('button, input, select, textarea')) { e.preventDefault(); toggleSpin(); }\n});`);
replace("startPsk();", "if (!LINK.offline) startPsk(); else { $('pskNote').textContent = 'Offline acceptance · external feeds disabled'; }");
replace('  let m; try { m = JSON.parse(payload); } catch (e) { return; }', `  let m; try { m = JSON.parse(payload); } catch (e) { return; }\n  if (!m || !/^[A-Z0-9/]{1,32}$/.test(m.sc) || !/^[A-Z0-9/]{1,32}$/.test(m.rc) ||\n      typeof m.sl !== 'string' || typeof m.rl !== 'string' || !gridToLatLon(m.sl) || !gridToLatLon(m.rl) ||\n      !Number.isFinite(m.rp) || Math.abs(m.rp) > 200 || !/^[0-9]{1,3}m$/.test(m.b) || !/^[A-Z0-9-]{1,16}$/.test(m.md)) return;`);
replace('  requestAnimationFrame(frame);', '  setTimeout(() => requestAnimationFrame(frame), document.hidden ? 1000 : 16);');
replace('window.__mc = { cam, arcs, get heard() { return heard; }, onHeard, handleEvent, showRig };', 'window.__hmControl = { get logbookCount() { return priorLog.logbook.total; }, get mappedPoints() { return QSOS.length; } };');
js = js.replaceAll('three/addons/', 'three/examples/jsm/');
let html = source.slice(0, source.indexOf('<script type="module">')) + '</body>\n</html>\n';
html = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<link[^>]*>/g, '')
  .replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="./dashboard.css">')
  .replace('<title>Ham Mission Control</title>', '<title>OM0RX-xLog — HM Control</title>')
  .replace(/  <button class="chip" id="setupBtn">.*?<\/button>\n/, '')
  .replace(/<div id="setup">[\s\S]*$/, '</body>\n</html>\n');
html = html.replace('</body>', `<div id="xlog-link" role="status">Connecting to xLog…</div><button id="xlog-retry" hidden>Reconnect</button>\n<div id="xlog-credit">Ham Mission Control · Billy NZ3C · MIT · Integrated with OM0RX-xLog</div>\n<script type="module" src="./boot.js"></script>\n</body>`);
const css = source.match(/<style>([\s\S]*?)<\/style>/)[1] + `\n/* xLog integration chrome; preserve Billy's dashboard composition. */\n:root { --mono: ui-monospace, 'SFMono-Regular', Menlo, monospace; --sans: -apple-system, BlinkMacSystemFont, sans-serif; }\n#xlog-link, #xlog-credit { position: fixed; z-index: 20; color: #b5c5d8; background: #07111f; padding: 5px 10px; font: 11px/1.4 var(--sans); }\n#xlog-link { left: 0; bottom: 0; max-width: 78%; } #xlog-link.failed { color: #ffb627; }\n#xlog-credit { right: 0; bottom: 0; font-size: 10px; }\n#xlog-retry { position: fixed; z-index: 21; bottom: 34px; left: 10px; color: #e6edf6; background: #101f34; border: 1px solid #35c8f5; border-radius: 6px; padding: 8px 14px; cursor: pointer; }\nbutton:focus-visible { outline: 2px solid #35c8f5; outline-offset: 3px; }\n::selection { background: #164c63; color: #fff; }\n@media (max-width: 1100px) { #xlog-credit { display: none; } #xlog-link { max-width: 100%; font-size: 10px; } }\n@media (prefers-reduced-motion: reduce) { #toast, #celebrate, #flash { animation: none; } }\n`;
await Promise.all([writeFile(output + 'dashboard.js', js), writeFile(output + 'index.html', html), writeFile(output + 'dashboard.css', css)]);
console.log('HM Control: generated local dashboard from pinned upstream source');
