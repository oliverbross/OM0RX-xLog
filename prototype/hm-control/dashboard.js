// Derived from Billy NZ3C Ham Mission Control; MIT (see vendor notice).
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import * as satellite from 'satellite.js';
import mqtt from 'mqtt';
import { connectXLog, publicFetch, updateCluster, announceLogChanges } from './xlog-adapter.js';
const LINK = await connectXLog();
const fetch = (url, options) => publicFetch(LINK, url, options);

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";

// =====================================================================
// YOUR SETTINGS: easiest is the setup screen that opens the first time (later: the SETUP button or S key).
// Those are saved in the browser and win over these lines. To build your details into the file
// instead (for a kiosk that gets wiped), change these lines, save, and reopen the page.
// =====================================================================
const EMBED = false;
const CFG = { ...LINK.home, relay: '' };
const HOME = { ...LINK.home, name: LINK.home.town };

const SATS = { "ISS (ZARYA)": "ISS", "SAUDISAT 1C (SO-50)": "SO-50", "OSCAR 7 (AO-7)": "AO-7", "RS-44 & BREEZE-KM R/B": "RS-44",
  "GREENCUBE (IO-117)": "IO-117", "JAS-2 (FO-29)": "FO-29", "FUNCUBE-1 (AO-73)": "AO-73", "RADFXSAT (FOX-1B)": "AO-91",
  "EYESAT A (AO-27)": "AO-27", "XW-3 (CAS-9)": "CAS-9", "DIWATA-2B": "PO-101" };
const BAND_COLOR = { "160m":"#c084fc","80m":"#a78bfa","60m":"#818cf8","40m":"#60a5fa","30m":"#22d3ee","20m":"#34d399",
  "17m":"#a3e635","15m":"#facc15","12m":"#fb923c","10m":"#f87171","6m":"#f472b6","2m":"#f5f5f5" };
const ACT_BANDS = ["160m","80m","40m","30m","20m","17m","15m","12m","10m","6m"];
const bandColor = b => BAND_COLOR[b] || "#9ca3af";
const IMG = "/hm-control-assets/";
const D2R = Math.PI / 180, R2D = 180 / Math.PI, EARTH_KM = 6371;



// ---------- Fit the 1920x1080 design to the screen ----------
const stage = document.getElementById("stage");
function fit() {
  const s = Math.min(innerWidth / 1920, innerHeight / 1080);
  stage.style.transform = `translate(${(innerWidth - 1920 * s) / 2}px, ${(innerHeight - 1080 * s) / 2}px) scale(${s})`;
}
addEventListener("resize", fit); fit();

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, "0");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const localTime = d => d.toLocaleTimeString("en-US", { timeZone: HOME.tz, hour: "numeric", minute: "2-digit" });
const miles = (a, b) => d3.geoDistance([a.lon, a.lat], [b.lon, b.lat]) * 3958.8;
function gridOf(lat, lon) {
  const L = lon + 180, A = lat + 90;
  return String.fromCharCode(65 + Math.floor(L / 20), 65 + Math.floor(A / 10)) + Math.floor((L % 20) / 2) + Math.floor(A % 10) +
    String.fromCharCode(97 + Math.floor((L % 2) * 12), 97 + Math.floor((A % 1) * 24));
}
function gridToLatLon(g) {
  g = (g || "").trim().toUpperCase();
  if (!/^[A-R]{2}[0-9]{2}/.test(g)) return null;
  let lon = (g.charCodeAt(0) - 65) * 20 - 180 + (+g[2]) * 2, lat = (g.charCodeAt(1) - 65) * 10 - 90 + (+g[3]);
  if (/^[A-R]{2}[0-9]{2}[A-X]{2}/.test(g)) { lon += (g.charCodeAt(4) - 65) / 12 + 1 / 24; lat += (g.charCodeAt(5) - 65) / 24 + 1 / 48; }
  else { lon += 1; lat += .5; }
  return { lat, lon };
}
function bearing(a, b) {
  const p1 = a.lat * D2R, p2 = b.lat * D2R, dl = (b.lon - a.lon) * D2R;
  return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * R2D + 360) % 360;
}
$("qth").textContent = `${HOME.name} · ${gridOf(HOME.lat, HOME.lon)}`;
document.title = `${HOME.call} Mission Control`;
$("brandCall").textContent = HOME.call; $("passTown").textContent = HOME.name;
$("airCall").textContent = HOME.call; $("keyCall").textContent = HOME.call;
$("azGrid").textContent = "FROM " + gridOf(HOME.lat, HOME.lon).slice(0, 4);

// ---------- Clocks ----------
function tickClock() {
  const now = new Date();
  $("utc").innerHTML = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}<span class="s">:${pad(now.getUTCSeconds())}</span>`;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: HOME.tz, hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23", timeZoneName: "short" }).formatToParts(now).map(x => [x.type, x.value]));
  $("loc").innerHTML = `${p.hour}:${p.minute}<span class="s">:${p.second}</span>`;
  $("locLbl").textContent = `LOCAL · ${p.timeZoneName}`;
  $("date").textContent = now.toLocaleDateString("en-US", { timeZone: HOME.tz, weekday: "long", month: "short", day: "numeric" });
}
setInterval(tickClock, 1000); tickClock();

// =====================================================================
// 3D GLOBE
// =====================================================================
const canvas = $("globe");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.setSize(1920, 1080, false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(32, 1920 / 1080, .1, 200);
camera.setViewOffset(1920, 1080, 326, 0, 1920, 1080);   // shifts the globe left, leaving room for the radar

// lat/lon -> point, matching how three.js wraps an equirectangular image on a sphere
function ll2v(lat, lon, r = 1) {
  const phi = (90 - lat) * D2R, th = (lon + 180) * D2R;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
}
const loader = new THREE.TextureLoader();
loader.setCrossOrigin("anonymous");
const tex = url => { const t = loader.load(url); t.anisotropy = 8; return t; };

const sunDir = new THREE.Vector3(1, 0, 0);
const earthMat = new THREE.ShaderMaterial({
  uniforms: { dayTex: { value: tex(IMG + "earth-blue-marble.jpg") }, nightTex: { value: tex(IMG + "earth-night.jpg") },
              waterTex: { value: tex(IMG + "earth-water.png") }, sunDir: { value: sunDir } },
  vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vP;
    void main(){ vUv = uv; vN = normalize(normal); vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D dayTex, nightTex, waterTex; uniform vec3 sunDir; varying vec2 vUv; varying vec3 vN; varying vec3 vP;
    void main(){
      vec3 n = normalize(vN); float d = dot(n, normalize(sunDir));
      float dayMix = smoothstep(-.10, .22, d);
      vec3 day = texture2D(dayTex, vUv).rgb;
      vec3 night = texture2D(nightTex, vUv).rgb; night = pow(night, vec3(1.3)) * vec3(1.9, 1.45, .9) * 1.7;
      vec3 view = normalize(cameraPosition - vP);
      float water = texture2D(waterTex, vUv).r;
      float spec = pow(max(dot(n, normalize(normalize(sunDir) + view)), 0.), 60.) * water * .9 * dayMix;
      vec3 col = mix(night + day * .025, day * (.22 + .95 * max(d, 0.)), dayMix);
      col += vec3(1., .92, .8) * spec;
      col += vec3(1., .42, .12) * .10 * smoothstep(.22, 0., abs(d - .02));     // sunset band
      float rim = pow(1. - max(dot(n, view), 0.), 3.);
      col += vec3(.25, .55, 1.) * rim * (.12 + .5 * dayMix);
      gl_FragColor = vec4(col, 1.);
    }` });
const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 160, 160), earthMat);
scene.add(earth);

const cloudMat = new THREE.ShaderMaterial({
  uniforms: { cloudTex: { value: tex(IMG + "clouds.png") }, sunDir: { value: sunDir } },
  transparent: true, depthWrite: false,
  vertexShader: `varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `uniform sampler2D cloudTex; uniform vec3 sunDir; varying vec2 vUv; varying vec3 vN;
    void main(){ vec4 c = texture2D(cloudTex, vUv); float a = max(c.a * dot(c.rgb, vec3(.33)), 0.);
      float lit = smoothstep(-.12, .3, dot(normalize(vN), normalize(sunDir)));
      gl_FragColor = vec4(vec3(1.) * (.05 + .95 * lit), a * (.25 + .6 * lit)); }` });
const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.007, 120, 120), cloudMat);
scene.add(clouds);

const atmo = new THREE.Mesh(new THREE.SphereGeometry(1.085, 96, 96), new THREE.ShaderMaterial({
  side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
  fragmentShader: `varying vec3 vN; void main(){ float i = pow(max(.66 - dot(vN, vec3(0,0,1.)), 0.), 4.); gl_FragColor = vec4(.32, .64, 1., 1.) * i * 2.2; }` }));
scene.add(atmo);

(() => {   // starfield
  const n = 5000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(60 + Math.random() * 40);
    pos.set([v.x, v.y, v.z], i * 3);
    const b = .35 + Math.random() * .65, warm = Math.random() < .2;
    col.set(warm ? [b, b * .85, b * .65] : [b * .8, b * .9, b], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ size: .18, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: .9 })));
})();

// Soft round glow sprite used for points
const glowTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(.25, "rgba(255,255,255,.75)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
function glow(color, size) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size); return s;
}

// Sun position (where it's overhead) drives the day/night shading
function subsolar(date) {
  const d = (date - Date.UTC(2000, 0, 1, 12)) / 864e5;
  const g = (357.529 + .98560028 * d) * D2R, q = 280.459 + .98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + .020 * Math.sin(2 * g)) * D2R, e = (23.439 - 3.6e-7 * d) * D2R;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) * R2D, dec = Math.asin(Math.sin(e) * Math.sin(L)) * R2D;
  let lon = ra - (280.46061837 + 360.98564736629 * d) % 360; lon = ((lon + 540) % 360) - 180;
  return { lat: dec, lon };
}
function updateSun() { const s = subsolar(new Date()); sunDir.copy(ll2v(s.lat, s.lon)).normalize(); }
updateSun(); setInterval(updateSun, 30e3);

// Home beacon
const homeV = ll2v(HOME.lat, HOME.lon, 1.002);
const homeGroup = new THREE.Group(); scene.add(homeGroup);
const homeCore = glow(0xffb627, .07); homeCore.position.copy(homeV); homeGroup.add(homeCore);
const beaconGeo = new THREE.CylinderGeometry(.0035, .0035, .16, 8); beaconGeo.translate(0, .08, 0);
const beacon = new THREE.Mesh(beaconGeo, new THREE.MeshBasicMaterial({ color: 0xffb627, transparent: true, opacity: .85, blending: THREE.AdditiveBlending }));
beacon.position.copy(homeV); beacon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), homeV.clone().normalize()); homeGroup.add(beacon);
const ringGeo = new THREE.RingGeometry(.9, 1, 64);
const homeRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffb627, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
homeRing.position.copy(ll2v(HOME.lat, HOME.lon, 1.003)); homeRing.lookAt(homeRing.position.clone().multiplyScalar(2)); homeGroup.add(homeRing);

// ---------- Logbook contacts: light pillars ----------
let QSOS = LINK.initial.log.logbook.points, isSample = false;

const qsoGroup = new THREE.Group(); scene.add(qsoGroup);
function drawQsos() {
  qsoGroup.traverse(object => { if (object !== qsoGroup) { object.geometry?.dispose(); object.material?.dispose(); } });
  qsoGroup.clear();
  const seen = new Set();
  for (const q of QSOS) {
    if (q.lat == null) continue;
    const k = q.lat.toFixed(0) + "," + q.lon.toFixed(0); if (seen.has(k)) continue; seen.add(k);
    const v = ll2v(q.lat, q.lon, 1.001), up = v.clone().normalize();
    const h = .035;
    const g = new THREE.CylinderGeometry(.0016, .0016, h, 6); g.translate(0, h / 2, 0);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: bandColor(q.band), transparent: true, opacity: .8, blending: THREE.AdditiveBlending }));
    m.position.copy(v); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up); qsoGroup.add(m);
    const tip = glow(bandColor(q.band), .022); tip.position.copy(v.clone().add(up.clone().multiplyScalar(h))); qsoGroup.add(tip);
  }
}
drawQsos();

// ---------- Arcs between two places ----------
const arcGroup = new THREE.Group(); scene.add(arcGroup);
const arcs = [];
function arcPoints(a, b, n = 72, lift = 1) {
  const interp = d3.geoInterpolate([a.lon, a.lat], [b.lon, b.lat]);
  const dist = d3.geoDistance([a.lon, a.lat], [b.lon, b.lat]);
  const h = (.015 + dist * .085) * lift, pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, [lon, lat] = interp(t); pts.push(ll2v(lat, lon, 1.003 + h * Math.sin(Math.PI * t))); }
  return pts;
}
// thin additive line for worldwide traffic
function addArc(a, b, color, { life = 5, grow = 1.4 } = {}) {
  const pts = arcPoints(a, b), flat = [];
  pts.forEach(p => flat.push(p.x, p.y, p.z));
  const g = new LineGeometry(); g.setPositions(flat); g.instanceCount = 0;
  const mat = new LineMaterial({ color, linewidth: 1.7, transparent: true, opacity: .8, blending: THREE.AdditiveBlending, depthWrite: false });
  mat.resolution.set(1920, 1080);
  const line = new Line2(g, mat); arcGroup.add(line);
  const end = glow(color, .035); end.position.copy(pts[pts.length - 1]); end.material.opacity = 0; arcGroup.add(end);
  arcs.push({ line, end, born: performance.now() / 1000, life, grow, n: pts.length - 1, fat: true, mat, thin: true });
}
// fat glowing arc for your station being heard
const fatMats = [];
// Your own signal: white-hot core inside a wide amber glow, with a pulse running out to the station.
// Built to look nothing like the thin band-colored worldwide arcs.
function removeArc(i) {
  const a = arcs[i];
  for (const o of [a.line, a.end, a.halo, a.pulse]) if (o) { arcGroup.remove(o); if (o.isLine2) o.geometry.dispose(); o.material.dispose(); }   // sprites share one geometry
  arcs.splice(i, 1);
}
function addFatArc(a, b, key, life = 1800, { core = 0xffe7b0, glowHex = 0xff9a1f } = {}) {
  const old = arcs.findIndex(x => x.key === key); if (old >= 0) removeArc(old);   // one beam per station
  const pts = arcPoints(a, b, 96, 1.3), flat = [];
  pts.forEach(p => flat.push(p.x, p.y, p.z));
  // Dim near home and full strength from ~20% of the way out, so dozens of beams
  // starting at the same spot don't pile up into a white blob over the QTH
  const ramp = i => { const t = i / (pts.length - 1); return Math.min(1, Math.max(.04, (t - .02) / .2)); };
  const make = (hex, width, opacity) => {
    const c = new THREE.Color(hex), cols = [];
    pts.forEach((p, i) => { const r = ramp(i); cols.push(c.r * r, c.g * r, c.b * r); });
    const g = new LineGeometry(); g.setPositions(flat); g.setColors(cols); g.instanceCount = 0;
    const m = new LineMaterial({ color: 0xffffff, vertexColors: true, linewidth: width, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    m.resolution.set(1920, 1080); return new Line2(g, m);
  };
  const halo = make(glowHex, 4.5, .1), line = make(core, 1.5, .6);
  arcGroup.add(halo); arcGroup.add(line);
  const end = glow(0xffd27a, .03); end.position.copy(pts[pts.length - 1]); arcGroup.add(end);
  const pulse = glow(0xfff0c8, .035); pulse.material.opacity = 0; arcGroup.add(pulse);
  arcs.push({ key, line, halo, end, pulse, pts, born: performance.now() / 1000, life, grow: 2.2, n: pts.length - 1, fat: true, mat: line.material });
}
function updateArcs(t) {
  let rank = 0;
  for (let i = arcs.length - 1; i >= 0; i--) if (arcs[i].halo) arcs[i].rank = rank++;   // 0 = newest beam
  for (let i = arcs.length - 1; i >= 0; i--) {
    const a = arcs[i], age = t - a.born, k = Math.min(1, age / a.grow);
    const shown = Math.max(2, Math.floor(a.n * (1 - Math.pow(1 - k, 3))));
    a.line.geometry.instanceCount = shown;
    const fade = age < a.life - 1.5 ? 1 : Math.max(0, (a.life - age) / 1.5);
    // a beam is "hot" for its first 90 s and while it's one of the 6 newest; after that it's a faint ghost
    const hot = !a.halo || (a.rank < 6 && age < 90);
    const b = hot ? 1 : .18;
    a.mat.opacity = (a.thin ? .8 : .6) * fade * b;
    a.end.material.opacity = k >= 1 ? fade * (a.thin ? .9 : Math.max(.45, b)) : 0;
    if (a.halo) {
      a.halo.geometry.instanceCount = shown;
      a.halo.material.opacity = hot ? (.08 + .04 * Math.sin(t * 3)) * fade : 0;
      // a pulse travels home -> station every 2.4 s while the beam is hot
      const p = k >= 1 ? ((age - a.grow) % 2.4) / 2.4 : 0;
      a.pulse.material.opacity = hot && k >= 1 ? .8 * fade * Math.sin(Math.PI * p) : 0;
      a.pulse.position.copy(a.pts[Math.min(a.n, Math.floor(p * a.n))]);
      a.end.scale.setScalar(.03 * (hot ? 1 + .3 * Math.max(0, Math.sin(t * 4)) : .8));
    }
    if (age > a.life) removeArc(i);
  }
}

// ---------- Satellites ----------
const satGroup = new THREE.Group(); scene.add(satGroup);
let sats = [];
const observer = { latitude: HOME.lat * D2R, longitude: HOME.lon * D2R, height: .03 };
function satNow(s, date) {
  const pv = satellite.propagate(s.rec, date); if (!pv.position) return null;
  const gmst = satellite.gstime(date), gd = satellite.eciToGeodetic(pv.position, gmst);
  return { lat: gd.latitude * R2D, lon: gd.longitude * R2D, alt: gd.height, look: satellite.ecfToLookAngles(observer, satellite.eciToEcf(pv.position, gmst)) };
}
async function loadTles() {
  let txt = null;
  try { const c = JSON.parse(localStorage.getItem("hamclock-tle") || "null"); if (c && Date.now() - c.t < 6 * 3600e3) txt = c.txt; } catch (e) {}
  if (!txt) {   // CelesTrak asks not to re-download more than every couple of hours
    txt = await (await fetch("https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=tle")).text();
    try { localStorage.setItem("hamclock-tle", JSON.stringify({ t: Date.now(), txt })); } catch (e) {}
  }
  const L = txt.split(/\r?\n/); const out = [];
  for (let i = 0; i + 2 < L.length; i++) {
    const name = L[i].trim();
    if (SATS[name] && L[i + 1].startsWith("1 ") && L[i + 2].startsWith("2 "))
      out.push({ name: SATS[name], iss: name.startsWith("ISS"), rec: satellite.twoline2satrec(L[i + 1], L[i + 2]) });
  }
  return out;
}
// Orbit ring drawn in space (frozen to the current Earth rotation so it's a clean loop)
function orbitRing(s) {
  const now = new Date(), gmst = satellite.gstime(now), period = 2 * Math.PI / s.rec.no;   // minutes
  const pts = [];
  for (let m = 0; m <= period + .5; m += period / 180) {
    const pv = satellite.propagate(s.rec, new Date(+now + m * 60e3)); if (!pv.position) continue;
    const e = satellite.eciToEcf(pv.position, gmst), r = Math.hypot(e.x, e.y, e.z);
    pts.push(ll2v(Math.asin(e.z / r) * R2D, Math.atan2(e.y, e.x) * R2D, r / EARTH_KM));
  }
  return pts;
}
function buildSats() {
  satGroup.clear();
  for (const s of sats) {
    const pts = orbitRing(s), flat = []; pts.forEach(p => flat.push(p.x, p.y, p.z));
    const g = new LineGeometry(); g.setPositions(flat);
    s.ringMat = new LineMaterial({ color: s.iss ? 0xffffff : 0xc4f542, linewidth: s.iss ? 1.6 : 1, transparent: true, opacity: s.iss ? .45 : .22,
      blending: THREE.AdditiveBlending, depthWrite: false });
    s.ringMat.resolution.set(1920, 1080); fatMats.push(s.ringMat);
    satGroup.add(new Line2(g, s.ringMat));
    s.dot = glow(s.iss ? 0xffffff : 0xc4f542, s.iss ? .085 : .055); satGroup.add(s.dot);
    s.core = new THREE.Mesh(new THREE.SphereGeometry(s.iss ? .011 : .007, 12, 12), new THREE.MeshBasicMaterial({ color: s.iss ? 0xffffff : 0xe8ff9a }));
    satGroup.add(s.core);
  }
}
function updateSats() {
  const now = new Date();
  for (const s of sats) {
    const p = satNow(s, now); if (!p) continue;
    s.pos = p; s.v = ll2v(p.lat, p.lon, 1 + p.alt / EARTH_KM); s.up = p.look.elevation > 0;
    s.dot.position.copy(s.v); s.core.position.copy(s.v);
    s.dot.material.color.set(s.up ? 0xffffff : (s.iss ? 0xffffff : 0xc4f542));
  }
}
function findPasses() {
  const now = Date.now(), out = [];
  for (const s of sats) {
    let cur = null, n = 0;
    for (let t = now; t < now + 12 * 3600e3; t += 30e3) {
      const p = satNow(s, new Date(t)); if (!p) break;
      const el = p.look.elevation * R2D;
      if (el > 0) { if (!cur) cur = { s, aos: t, max: el }; else cur.max = Math.max(cur.max, el); }
      else if (cur) { cur.los = t; out.push(cur); cur = null; if (++n >= 2) break; }
    }
    if (cur) { cur.los = now + 12 * 3600e3; out.push(cur); }
  }
  return out.filter(o => o.max >= 10).sort((a, b) => a.aos - b.aos);
}
let passes = [];
function showPasses() {
  const now = Date.now(); passes = passes.filter(p => p.los > now);
  $("passList").innerHTML = passes.slice(0, 3).map(p => {
    const up = p.aos <= now, mins = Math.round((p.aos - now) / 60e3);
    let inTxt = mins < 60 ? `in ${mins}m` : `in ${Math.floor(mins / 60)}h${pad(mins % 60)}`;
    if (up) { const q = satNow(p.s, new Date()); inTxt = q ? `UP ${Math.round(q.look.elevation * R2D)}°` : "UP"; }
    return `<div class="pass${up ? " up" : ""}"><span class="n${p.s.iss ? " iss" : ""}">${p.s.name}</span><span class="w">${localTime(new Date(p.aos))}</span>
      <span class="e">max <b>${Math.round(p.max)}°</b></span><span class="in">${inTxt}</span></div>`;
  }).join("") || `<div class="pass"><span class="e" style="grid-column:1/-1;text-align:left">No good passes in the next 12 hours</span></div>`;
}
async function startSats() {
  try {
    sats = await loadTles(); buildSats(); updateSats(); passes = findPasses(); showPasses();
    $("satNote").textContent = `${sats.length} sats tracked`;
  } catch (e) { $("satNote").textContent = "satellite data offline"; }
}
startSats();
setInterval(() => { if (sats.length) { updateSats(); showPasses(); } }, 1000);
setInterval(() => { if (sats.length) { passes = findPasses(); buildSats(); updateSats(); } }, 10 * 60e3);
setInterval(startSats, 6 * 3600e3);

// ---------- HTML labels that follow points on the globe ----------
const labelsEl = $("labels");
const labelPool = new Map();
function label(key, cls, html) {
  let el = labelPool.get(key);
  if (!el) { el = document.createElement("div"); labelsEl.appendChild(el); labelPool.set(key, el); }
  el.className = "gl " + cls; if (el._h !== html) { el.innerHTML = html; el._h = html; }
  el._used = true; return el;
}
const tmpV = new THREE.Vector3(), ray = new THREE.Ray();
function visible(p) {   // false when the Earth is between the camera and the point
  ray.origin.copy(camera.position); ray.direction.copy(p).sub(camera.position).normalize();
  const hit = ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), .995), tmpV);
  return !hit || hit.distanceTo(camera.position) > p.distanceTo(camera.position) - 1e-3;
}
function place(el, p) {
  if (!visible(p)) { el.style.display = "none"; return; }
  tmpV.copy(p).project(camera);
  const x = (tmpV.x + 1) / 2 * 1920, y = (1 - tmpV.y) / 2 * 1080;
  if (x > 1250) { el.style.display = "none"; return; }
  el.style.display = "block"; el.style.left = x + "px"; el.style.top = y + "px";
}
function updateLabels() {
  labelPool.forEach(el => el._used = false);
  place(label("home", "home", HOME.call), homeV);
  const qm = $("qthMark"), hl = labelPool.get("home");
  qm.style.display = hl.style.display; qm.style.left = hl.style.left; qm.style.top = hl.style.top;
  qm.classList.toggle("tx", !!rigState.tx);
  for (const s of sats) if (s.v) place(label("sat" + s.name, s.iss ? "iss" : "sat", s.name), s.v);
  for (const h of [...heard].filter(h => h.mi > 400).sort((a, b) => b.mi - a.mi).slice(0, 6)) place(label("h" + h.call, "heard", `${esc(h.call)} <span>${h.snr} dB</span>`), h.v);
  labelPool.forEach((el, k) => { if (!el._used) { el.remove(); labelPool.delete(k); } });
}

// ---------- Camera: slow orbit, swings home when you are heard ----------
const cam = { lon: HOME.lon - 25, lat: 24, dist: 14, focus: null, focusUntil: 0 };
cam.paused = false; cam.holdUntil = 0;   // paused = operator stopped the slow turn; holdUntil = just dragged it
try { cam.paused = localStorage.getItem("hamclock-spin") === "1"; } catch (e) {}
// Any angle -> -180..180. JS % keeps the sign of a negative number, so wrap twice; the old one-step version
// sent the camera spinning for the whole swing once cam.lon had grown past a few hundred degrees.
const wrap180 = d => (((d + 180) % 360) + 360) % 360 - 180;
const camFree = () => !cam.paused && performance.now() / 1000 > cam.holdUntil;   // false while the operator holds the view
let intro = true;
function updateCamera(t, dt) {
  if (intro) { cam.dist += (4.35 - cam.dist) * Math.min(1, dt * 1.1); if (Math.abs(cam.dist - 4.35) < .01) intro = false; }
  if (cam.focus && t < cam.focusUntil) {
    const dl = wrap180(cam.focus.lon - cam.lon);
    cam.lon += dl * Math.min(1, dt * .8); cam.lat += (cam.focus.lat - cam.lat) * Math.min(1, dt * .8);
  } else {
    cam.focus = null;
    if (camFree()) {
      cam.lon += dt * 2.2;   // one turn about every 2.7 minutes
      cam.lat += (22 - cam.lat) * Math.min(1, dt * .3);
    }
  }
  cam.lon = wrap180(cam.lon);
  camera.position.copy(ll2v(cam.lat, cam.lon, cam.dist)); camera.lookAt(0, 0, 0);
}

// Hand control: drag the globe to turn it; it holds there for a minute, then the slow turn picks up again.
// Space (or the button) stops/starts the slow turn for good, and the browser remembers the choice.
// While the operator holds the view, "heard by" swings and pop-ups leave the camera alone.
const spinBtn = $("spinBtn");
let dragAt = null;
function showSpin() { spinBtn.classList.toggle("on", cam.paused); spinBtn.textContent = cam.paused ? "\u25B6 GLOBE STOPPED \u00B7 SPACE" : "\u23F8 STOP GLOBE"; }
function toggleSpin() {
  cam.paused = !cam.paused; cam.holdUntil = 0;
  try { localStorage.setItem("hamclock-spin", cam.paused ? "1" : ""); } catch (e) {}
  showSpin();
}
canvas.addEventListener("pointerdown", e => {
  dragAt = { x: e.clientX, y: e.clientY }; cam.focus = null; cam.holdUntil = performance.now() / 1000 + 60;
  canvas.setPointerCapture(e.pointerId); canvas.classList.add("drag");
});
canvas.addEventListener("pointermove", e => {
  if (!dragAt) return;
  const k = .12 * 1920 / stage.getBoundingClientRect().width;   // degrees per screen pixel (stage is scaled to fit)
  cam.lon -= (e.clientX - dragAt.x) * k;
  cam.lat = Math.max(-70, Math.min(75, cam.lat + (e.clientY - dragAt.y) * k));
  dragAt = { x: e.clientX, y: e.clientY }; cam.holdUntil = performance.now() / 1000 + 60;
});
const endDrag = () => { dragAt = null; canvas.classList.remove("drag"); };
canvas.addEventListener("pointerup", endDrag); canvas.addEventListener("pointercancel", endDrag);
spinBtn.addEventListener("click", () => { toggleSpin(); spinBtn.blur(); });
showSpin();

// =====================================================================
// RADAR SCOPE (azimuthal equidistant, centred on your QTH)
// =====================================================================
const rc = $("radar"), rx = rc.getContext("2d"), RS = 1244, RC = RS / 2, RR = RS / 2 - 18;
const rproj = d3.geoAzimuthalEquidistant().rotate([-HOME.lon, -HOME.lat]).clipAngle(179.5).scale(RR / Math.PI).translate([RC, RC]);
const land = document.createElement("canvas"); land.width = land.height = RS;
let landReady = false, countries = [];
d3.json("/hm-control-assets/countries-110m.json").then(world => {
  countries = topojson.feature(world, world.objects.countries).features;
  const g = land.getContext("2d"), p = d3.geoPath(rproj, g);
  g.beginPath(); p(topojson.feature(world, world.objects.land)); g.fillStyle = "rgba(61,255,158,.07)"; g.fill();
  g.lineWidth = 1.6; g.strokeStyle = "rgba(61,255,158,.55)"; g.shadowColor = "rgba(61,255,158,.8)"; g.shadowBlur = 6; g.stroke();
  g.shadowBlur = 0;
  // range rings every 2,500 miles, crosshairs and heading ticks
  g.strokeStyle = "rgba(61,255,158,.22)"; g.lineWidth = 1.2; g.fillStyle = "rgba(61,255,158,.6)"; g.font = "600 20px JetBrains Mono";
  for (const mi of [2500, 5000, 7500, 10000]) {
    const r = RR * (mi / 3958.8) / Math.PI;
    g.beginPath(); g.arc(RC, RC, r, 0, 2 * Math.PI); g.stroke(); g.fillText(mi.toLocaleString(), RC + 6, RC - r + 22);
  }
  g.beginPath(); g.moveTo(RC - RR, RC); g.lineTo(RC + RR, RC); g.moveTo(RC, RC - RR); g.lineTo(RC, RC + RR); g.stroke();
  for (let a = 0; a < 360; a += 5) {
    const r1 = RR - (a % 30 ? 8 : 18), s = Math.sin(a * D2R), c = -Math.cos(a * D2R);
    g.beginPath(); g.moveTo(RC + s * r1, RC + c * r1); g.lineTo(RC + s * RR, RC + c * RR); g.strokeStyle = "rgba(61,255,158,.6)"; g.stroke();
    if (a % 30 === 0) {
      g.save(); g.translate(RC + s * (RR - 38), RC + c * (RR - 38)); g.fillStyle = "rgba(61,255,158,.85)"; g.font = "700 22px JetBrains Mono";
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillText({ 0: "N", 90: "E", 180: "S", 270: "W" }[a] || String(a), 0, 0); g.restore();
    }
  }
  landReady = true;
  loadSpots();
});
const blips = { heard: [], spots: [], qso: [] };
function blipXY(o) { const p = rproj([o.lon, o.lat]); return p ? { x: p[0], y: p[1], az: bearing(HOME, o) } : null; }
function drawRadar(t) {
  rx.clearRect(0, 0, RS, RS);
  if (landReady) rx.drawImage(land, 0, 0);
  const sweep = (t * 60) % 360;   // one sweep every 6 s
  const ang = (sweep - 90) * D2R;
  const cg = rx.createConicGradient(ang - 1.2, RC, RC);
  cg.addColorStop(0, "rgba(61,255,158,0)"); cg.addColorStop(1.2 / (2 * Math.PI), "rgba(61,255,158,.30)"); cg.addColorStop(1.2 / (2 * Math.PI) + .001, "rgba(61,255,158,0)");
  rx.fillStyle = cg; rx.beginPath(); rx.arc(RC, RC, RR, 0, 2 * Math.PI); rx.fill();
  rx.strokeStyle = "rgba(160,255,200,.9)"; rx.lineWidth = 2.5; rx.shadowColor = "#3dff9e"; rx.shadowBlur = 14;
  rx.beginPath(); rx.moveTo(RC, RC); rx.lineTo(RC + Math.cos(ang) * RR, RC + Math.sin(ang) * RR); rx.stroke(); rx.shadowBlur = 0;

  const glowAt = az => { const d = (sweep - az + 360) % 360; return .18 + .82 * Math.exp(-d / 70); };
  const dot = (b, color, r, text) => {
    const k = glowAt(b.az);
    rx.globalAlpha = k; rx.fillStyle = color; rx.shadowColor = color; rx.shadowBlur = 16 * k;
    rx.beginPath(); rx.arc(b.x, b.y, r, 0, 2 * Math.PI); rx.fill(); rx.shadowBlur = 0;
    if (text && k > .35) { rx.font = "700 21px JetBrains Mono"; rx.fillText(text, b.x + r + 6, b.y + 7); }
    rx.globalAlpha = 1;
  };
  for (const b of blips.qso) dot(b, "rgba(61,255,158,.8)", 4);
  for (const b of blips.spots) dot(b, "#3ee6ff", 6, b.call);
  for (const s of sats) if (s.pos) { const b = blipXY(s.pos); if (b) dot(b, s.iss ? "#ffffff" : "#c4f542", s.iss ? 8 : 6, s.name); }
  for (const q of logged) if (q.b) dot(q.b, "#ffffff", 7, q.call);
  for (const h of heard) if (h.b) dot(h.b, "#ffb627", 8, h.call);
  // home in the centre
  rx.fillStyle = "#ffb627"; rx.shadowColor = "#ffb627"; rx.shadowBlur = 20; rx.beginPath(); rx.arc(RC, RC, 8, 0, 2 * Math.PI); rx.fill(); rx.shadowBlur = 0;
}
function refreshQsoBlips() { blips.qso = QSOS.filter(q => q.lat != null).map(q => ({ ...q, ...blipXY(q) })).filter(b => b.x != null); }
refreshQsoBlips();

// =====================================================================
// LIVE SIGNALS (PSKReporter MQTT)
// =====================================================================
let heard = [];            // stations hearing you, newest first
const bandCount = {};      // worldwide spots per band, rolling minute
const spotQueue = [];
let totalSpots = 0, lastFlash = 0;
function flash(main, sub) {
  const f = $("flash"); f.innerHTML = `${main}<small>${sub}</small>`;
  f.animate([{ opacity: 0, transform: "scale(.92)" }, { opacity: 1, transform: "scale(1)", offset: .12 }, { opacity: 1, offset: .75 }, { opacity: 0 }],
    { duration: 5200, easing: "ease-out" });
}
function onHeard(m) {
  const rl = gridToLatLon(m.rl); if (!rl) return;
  const call = m.rc, prev = heard.find(h => h.call === call);
  const rec = { call, grid: (m.rl || "").slice(0, 6), lat: rl.lat, lon: rl.lon, snr: m.rp, band: m.b, mode: m.md, t: Date.now(),
    mi: Math.round(miles(HOME, rl)), v: ll2v(rl.lat, rl.lon, 1.004) };
  rec.b = blipXY(rec); rec.az = Math.round(bearing(HOME, rl));
  heard = [rec, ...heard.filter(h => h.call !== call)];
  addFatArc(HOME, rl, call);
  if (!prev && Date.now() - lastFlash > 7000) {
    lastFlash = Date.now();
    flash(`HEARD BY ${call}`, `${rec.mi.toLocaleString()} MILES · ${rec.band} ${rec.mode} · ${rec.snr} dB`);
    const mid = d3.geoInterpolate([HOME.lon, HOME.lat], [rl.lon, rl.lat])(.5);
    if (camFree()) { cam.focus = { lon: mid[0], lat: Math.max(-10, Math.min(45, mid[1])) }; cam.focusUntil = performance.now() / 1000 + 14; }
  }
  showHeard(call);
}
function showHeard(newCall) {
  const cut = Date.now() - 30 * 60e3; heard = heard.filter(h => h.t > cut);
  $("heardN").textContent = heard.length;
  $("heardTxt").innerHTML = `station${heard.length === 1 ? "" : "s"} hearing ${esc(HOME.call)}<br>in the last 30 minutes`;
  if (heard.length) {
    const far = heard.reduce((a, b) => b.mi > a.mi ? b : a), best = heard.reduce((a, b) => b.snr > a.snr ? b : a);
    $("heardSub").innerHTML = `Farthest <b>${far.call}</b> ${far.mi.toLocaleString()} mi &nbsp;·&nbsp; Loudest <b>${best.call}</b> ${best.snr} dB`;
  } else $("heardSub").innerHTML = "Get on the air — every station that decodes you lights up here";
  $("heardList").innerHTML = heard.slice(0, 5).map(h => `<div class="hr${h.call === newCall ? " new" : ""}"><span class="c">${esc(h.call)}</span>
    <span>${esc(h.grid)}</span><span style="color:${bandColor(h.band)}">${esc(h.band)} ${esc(h.mode)}</span><span class="d">${h.mi.toLocaleString()} mi</span><span class="s">${h.snr} dB</span></div>`).join("");
}
showHeard();
setInterval(() => showHeard(), 30e3);

function onSpot(topic, payload) {
  let m; try { m = JSON.parse(payload); } catch (e) { return; }
  if (!m || !/^[A-Z0-9/]{1,32}$/.test(m.sc) || !/^[A-Z0-9/]{1,32}$/.test(m.rc) ||
      typeof m.sl !== 'string' || typeof m.rl !== 'string' || !gridToLatLon(m.sl) || !gridToLatLon(m.rl) ||
      !Number.isFinite(m.rp) || Math.abs(m.rp) > 200 || !/^[0-9]{1,3}m$/.test(m.b) || !/^[A-Z0-9-]{1,16}$/.test(m.md)) return;
  if (m.sc === HOME.call) { onHeard(m); return; }
  totalSpots++;
  const b = m.b; if (b) (bandCount[b] = bandCount[b] || []).push(Date.now());
  if (spotQueue.length < 400) spotQueue.push(m);
}
function startPsk() {
  try {
    const client = mqtt.connect("wss://mqtt.pskreporter.info:1886/mqtt", { reconnectPeriod: 8000, connectTimeout: 15000 });
    client.on("connect", () => {
      $("pskDot").className = "livedot"; $("pskNote").textContent = "live from PSKReporter";
      client.subscribe(["pskr/filter/v2/+/+/" + HOME.call + "/#", "pskr/filter/v2/+/FT8/#"].concat(EMBED ? [] : ["pskr/filter/v2/+/CW/#"]));
    });
    client.on("message", (topic, payload) => onSpot(topic, payload.toString()));
    client.on("close", () => { $("pskDot").className = "livedot off"; $("pskNote").textContent = "reconnecting…"; });
  } catch (e) { $("pskNote").textContent = "PSKReporter offline"; }
}
if (!LINK.offline) startPsk(); else { $('pskNote').textContent = 'Offline acceptance · external feeds disabled'; }
// Draw a few worldwide signals per second, preferring long hauls (they look best)
setInterval(() => {
  if (!spotQueue.length || arcs.length > (EMBED ? 90 : 160)) return;
  let best = null, bestD = 0;
  for (let i = 0; i < 6 && spotQueue.length; i++) {
    const m = spotQueue.splice(Math.floor(Math.random() * spotQueue.length), 1)[0];
    const a = gridToLatLon(m.sl), b = gridToLatLon(m.rl); if (!a || !b) continue;
    const d = d3.geoDistance([a.lon, a.lat], [b.lon, b.lat]); if (d > bestD) { bestD = d; best = { a, b, band: m.b }; }
  }
  if (best && bestD > .05) addArc(best.a, best.b, bandColor(best.band), { life: 4 + Math.random() * 3 });
  if (spotQueue.length > 300) spotQueue.splice(0, 200);
}, 140);
function showBands() {
  const cut = Date.now() - 60e3;
  for (const b in bandCount) bandCount[b] = bandCount[b].filter(t => t > cut);
  const max = Math.sqrt(Math.max(1, ...ACT_BANDS.map(b => (bandCount[b] || []).length)));
  $("bands").innerHTML = ACT_BANDS.map(b => { const n = (bandCount[b] || []).length;
    return `<div><i style="height:${Math.max(2, Math.sqrt(n) / max * 38)}px;background:${bandColor(b)};box-shadow:0 0 10px ${bandColor(b)}"></i>${b.replace("m", "")}</div>`; }).join("");
  const perMin = ACT_BANDS.reduce((s, b) => s + (bandCount[b] || []).length, 0);
  $("actNote").textContent = `${perMin.toLocaleString()} spots / min · FT8 + CW`;
}
setInterval(showBands, 2000); showBands();

// Contacts come only from the authoritative xLog logbook.

// ---------- Weather ----------
const WX = { 0:"Clear",1:"Mostly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Fog",51:"Drizzle",53:"Drizzle",55:"Drizzle",61:"Light rain",63:"Rain",
  65:"Heavy rain",66:"Freezing rain",67:"Freezing rain",71:"Light snow",73:"Snow",75:"Heavy snow",80:"Showers",81:"Showers",82:"Heavy showers",95:"Thunderstorms",96:"T-storms",99:"T-storms" };
const compass = d => ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(d / 22.5) % 16];
async function loadWeather() {
  try {
    const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${HOME.lat}&longitude=${HOME.lon}&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=UTC&forecast_days=1`)).json();
    const c = w.current, d = w.daily;
    $("temp").innerHTML = `${Math.round(c.temperature_2m)}&deg;`;
    $("cond").textContent = `${WX[c.weather_code] || ""} · ${compass(c.wind_direction_10m)} ${Math.round(c.wind_speed_10m)} mph`;
    $("sun").textContent = `H ${Math.round(d.temperature_2m_max[0])}° L ${Math.round(d.temperature_2m_min[0])}° · ☀ ${localTime(new Date(d.sunrise[0] + "Z"))} ☾ ${localTime(new Date(d.sunset[0] + "Z"))}`;
  } catch (e) { $("cond").textContent = "weather offline"; }
  try {
    const a = await (await fetch(`https://api.weather.gov/alerts/active?point=${HOME.lat},${HOME.lon}`)).json();
    const list = [...new Set((a.features || []).map(f => f.properties.event))];
    $("alert").style.display = list.length ? "block" : "none"; $("alert").textContent = list.length ? "⚠ " + list.join(" · ") : "";
  } catch (e) {}
}
loadWeather(); setInterval(loadWeather, 15 * 60e3);

// ---------- Space weather ----------
const kpColor = k => k >= 5 ? "var(--bad)" : k >= 4 ? "var(--amber)" : "var(--good)";
async function loadSpace() {
  try {
    const f = await (await fetch("https://services.swpc.noaa.gov/json/f107_cm_flux.json")).json(), v = Math.round(f[0].flux);
    $("sfi").textContent = v; $("sfi").style.color = v >= 150 ? "var(--good)" : v >= 100 ? "var(--amber)" : "var(--ink)";
    $("sfiX").textContent = v >= 150 ? "10m open" : v >= 100 ? "high bands ok" : "fair";
  } catch (e) {}
  try {
    const k = await (await fetch("https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json")).json();
    const rows = k.map(r => Array.isArray(r) ? { kp: +r[1], a: +r[2] } : { kp: +r.Kp, a: +r.a_running }).filter(r => !isNaN(r.kp)), last = rows[rows.length - 1];
    $("kp").textContent = last.kp.toFixed(1); $("kp").style.color = kpColor(last.kp); $("kpX").textContent = last.kp >= 5 ? "storm" : last.kp >= 4 ? "unsettled" : "quiet";
    $("aidx").textContent = Math.round(last.a); $("aidx").style.color = last.a >= 30 ? "var(--bad)" : last.a >= 15 ? "var(--amber)" : "var(--good)";
    $("aX").textContent = last.a >= 30 ? "disturbed" : last.a >= 15 ? "unsettled" : "settled";
  } catch (e) {}
  try {
    const x = await (await fetch("https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json")).json();
    const flux = x.filter(r => r.energy === "0.1-0.8nm").pop().flux;
    const cls = flux >= 1e-4 ? "X" : flux >= 1e-5 ? "M" : flux >= 1e-6 ? "C" : flux >= 1e-7 ? "B" : "A";
    $("xray").textContent = cls + (flux / { X: 1e-4, M: 1e-5, C: 1e-6, B: 1e-7, A: 1e-8 }[cls]).toFixed(1);
    $("xray").style.color = cls === "X" ? "var(--bad)" : cls === "M" ? "var(--amber)" : "var(--ink)";
    $("xrayX").textContent = cls === "X" || cls === "M" ? "FLARE" : "no flares";
  } catch (e) {}
}
loadSpace(); setInterval(loadSpace, 15 * 60e3);

// Shared xLog cluster, with the same report coordinates and freshness.
let tickerHtml = '';
function loadSpots() {
  updateCluster(LINK.current.context, { $, blips, blipXY, esc });
}

// =====================================================================
// RELAY (optional): logged contacts, QRZ confirmations, rig
// =====================================================================
// Served by the relay itself -> ask it directly; opened as a file -> use the relay setting (blank = no relay)
const SERVED_BY_RELAY = location.protocol.startsWith("http") && location.port === "8088";
const RELAY = EMBED || SERVED_BY_RELAY ? "" : String(CFG.relay || "").trim().replace(/\/+$/, "");
let lastId = -1, rigState = {}, logged = [];

// --- fireworks (2D canvas over everything) ---
const fx = $("fx"), fc = fx.getContext("2d"), sparks = [];
const FX_COLORS = ["#ffb627", "#3ee6ff", "#c4f542", "#ffffff", "#f472b6", "#a78bfa", "#ff6b4a"];
function burst(x, y, n = 140, colors = FX_COLORS) {
  const col = colors[Math.floor(Math.random() * colors.length)];
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 7;
    sparks.push({ x, y, px: x, py: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: .008 + Math.random() * .012,
      color: Math.random() < .2 ? "#ffffff" : col });
  }
}
let fireworksUntil = 0, fireworksAt = null;
function drawFx() {
  fc.clearRect(0, 0, 1920, 1080);
  const now = performance.now();
  if (now < fireworksUntil && Math.random() < .09) {
    const at = fireworksAt && Math.random() < .45 ? fireworksAt : { x: 160 + Math.random() * 950, y: 140 + Math.random() * 520 };
    burst(at.x + (Math.random() - .5) * 60, at.y + (Math.random() - .5) * 60);
  }
  fc.globalCompositeOperation = "lighter";
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.px = p.x; p.py = p.y; p.vx *= .975; p.vy = p.vy * .975 + .09; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
    if (p.life <= 0) { sparks.splice(i, 1); continue; }
    fc.strokeStyle = p.color; fc.globalAlpha = Math.min(1, p.life * 1.4); fc.lineWidth = 2.4;
    fc.beginPath(); fc.moveTo(p.px - p.vx * 2, p.py - p.vy * 2); fc.lineTo(p.x, p.y); fc.stroke();
  }
  fc.globalAlpha = 1; fc.globalCompositeOperation = "source-over";
}
function screenOf(lat, lon) {
  const v = ll2v(lat, lon, 1.01); if (!visible(v)) return null;
  tmpV.copy(v).project(camera); return { x: (tmpV.x + 1) / 2 * 1920, y: (1 - tmpV.y) / 2 * 1080 };
}

// --- big takeovers, one at a time ---
const showQueue = []; let showing = false;
function queueShow(fn) { showQueue.push(fn); if (!showing) nextShow(); }
function nextShow() {
  const fn = showQueue.shift(); if (!fn) { showing = false; return; }
  showing = true; fn(() => setTimeout(nextShow, 800));
}
function takeover({ k, n, c, cColor = "#fff", s, call = false, ms = 11000, at = null }, done) {
  $("ceK").textContent = k; $("ceN").textContent = n; $("ceN").className = "n" + (call ? " call" : "");
  $("ceC").textContent = c || ""; $("ceC").style.color = cColor; $("ceS").textContent = s || "";
  const el = $("celebrate");
  el.animate([{ opacity: 0, transform: "scale(.9)" }, { opacity: 1, transform: "scale(1)", offset: .07 }, { opacity: 1, offset: .9 }, { opacity: 0, transform: "scale(1.04)" }],
    { duration: ms, easing: "ease-out" });
  fireworksUntil = performance.now() + ms * .85; fireworksAt = at;
  for (let i = 0; i < 4; i++) setTimeout(() => burst(250 + Math.random() * 770, 200 + Math.random() * 400), i * 250);
  setTimeout(done, ms);
}

// --- small pop-ups, one at a time ---
const toastQueue = []; let toasting = false;
function toast(html, color, ms = 6500) {
  toastQueue.push({ html, color, ms }); if (!toasting) nextToast();
}
function nextToast() {
  const t = toastQueue.shift(); if (!t) { toasting = false; return; }
  toasting = true; const el = $("toast");
  el.innerHTML = t.html; el.style.borderColor = t.color; el.style.boxShadow = `0 0 30px ${t.color}55, 0 10px 40px rgba(0,0,0,.6)`;
  el.animate([{ opacity: 0, transform: "translate(-50%, -16px)" }, { opacity: 1, transform: "translate(-50%, 0)", offset: .08 }, { opacity: 1, offset: .88 }, { opacity: 0 }],
    { duration: t.ms, easing: "ease-out" });
  setTimeout(() => nextToast(), t.ms + 300);
}
function focusOn(lat, lon, secs = 14) { if (!camFree()) return; cam.focus = { lon, lat: Math.max(-10, Math.min(50, lat)) }; cam.focusUntil = performance.now() / 1000 + secs; }

function handleEvent(e) {
  if (e.type === "qso") {
    const mi = e.lat != null ? Math.round(miles(HOME, e)) : null;
    if (e.lat != null) {
      const col = new THREE.Color(bandColor(e.band));
      addFatArc(HOME, { lat: e.lat, lon: e.lon }, "qso:" + e.call, 1200, { core: col.clone().lerp(new THREE.Color(0xffffff), .6).getHex(), glowHex: col.getHex() });
      logged = [{ ...e, b: blipXY(e), t: Date.now() }, ...logged.filter(q => q.call !== e.call)].slice(0, 20);
    }
    toast(`<span class="tk" style="color:${bandColor(e.band)}">✎ LOGGED · ${esc(e.src || "")}</span><b>${esc(e.call)}</b> <span>· ${esc(e.band)} ${esc(e.mode)}${e.where ? " · " + esc(e.where) : ""}${mi ? " · " + mi.toLocaleString() + " mi" : ""}</span>`,
      bandColor(e.band));
  } else if (e.type === "confirm") {
    if (e.newCountry) {
      queueShow(done => {
        if (e.lat != null) focusOn(e.lat, e.lon, 9);
        takeover({ k: "✅ NEW COUNTRY CONFIRMED", n: e.where || e.call, c: `${e.call} · ${e.band} ${e.mode}`, cColor: "#4ade80", ms: 8000 }, done);
        setTimeout(() => { if (e.lat != null) { const p = screenOf(e.lat, e.lon); if (p) fireworksAt = p; } }, 2000);
      });
    } else {
      toast(`<span class="tk" style="color:#4ade80">✅ CONFIRMED</span><b>${esc(e.call)}</b> <span>· ${esc(e.where || "")} · ${esc(e.band)} ${esc(e.mode)}</span>`, "#4ade80");
      if (e.lat != null) { const p = screenOf(e.lat, e.lon); if (p) burst(p.x, p.y, 70, ["#4ade80", "#ffffff"]); }
    }
  }
}

function showRig(r) {
  rigState = r || {};
  const card = $("rigCard"), on = !!(r && r.freq);
  card.classList.toggle("off", !on);
  $("onAir").classList.toggle("tx", !!(on && r.tx));
  if (!on) { $("rigFreq").innerHTML = "&mdash;.&mdash;&mdash;&mdash;<span>.&mdash;&mdash;&mdash;</span>"; $("rigMode").textContent = "RIG OFF"; $("rigSrc").textContent = "waiting for WSJT-X"; return; }
  const hz = String(Math.round(r.freq)).padStart(7, "0"), mhz = hz.slice(0, -6), khz = hz.slice(-6, -3), h = hz.slice(-3);
  $("rigFreq").innerHTML = `${mhz}.${khz}<span>.${h}</span>`;
  $("rigMode").textContent = `${r.mode || ""} · ${r.band || ""}${r.tx && r.dx ? " · calling " + r.dx : ""}`;
  $("rigSrc").textContent = r.src || "";
}
// xLog owns the rig and all contact writes. There is no relay or demo rig.
showRig(null);
let priorLog = LINK.initial.log;
LINK.subscribe(value => {
  const next = value.log;
  if (next.generation !== priorLog.generation || next.logbook.revision !== priorLog.logbook.revision) {
    QSOS = next.logbook.points; drawQsos(); refreshQsoBlips();
    announceLogChanges(priorLog, next, handleEvent); priorLog = next;
  }
  showRig(value.rig);
  $('onAir').textContent = value.rig?.tx === true ? 'ON AIR' : value.rig?.tx === false ? 'RX' : 'PTT UNKNOWN';
  loadSpots();
});
addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.target.closest('button, input, select, textarea')) { e.preventDefault(); toggleSpin(); }
});

// =====================================================================
// RENDER LOOP
// =====================================================================
let last = performance.now() / 1000;
function frame() {
  const t = performance.now() / 1000, dt = Math.min(.1, t - last); last = t;
  updateCamera(t, dt);
  clouds.rotation.y += dt * .004;
  const k = (t % 2.4) / 2.4; homeRing.scale.setScalar(.01 + k * .07); homeRing.material.opacity = (1 - k) * .9;
  homeCore.scale.setScalar(.06 + Math.sin(t * 3) * .012);
  updateArcs(t);
  renderer.render(scene, camera);
  updateLabels();
  drawRadar(t);
  drawFx();
  setTimeout(() => requestAnimationFrame(frame), document.hidden ? 1000 : 16);
}
frame();
window.__hmControl = { get logbookCount() { return priorLog.logbook.total; }, get mappedPoints() { return QSOS.length; } };   // onHeard lets you test beams from the console   // handy for checking from the browser console
