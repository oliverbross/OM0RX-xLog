#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer as createHTTPServer } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite";
import { runBoundedChild } from "./bounded-child-process.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const prototype = join(root, "prototype");
const option = name => { const i = process.argv.indexOf(name); if (i < 0 || !process.argv[i + 1]) throw new Error(`Missing ${name}.`); return process.argv[i + 1]; };
const outputRoot = resolve(option("--output"));
const expectedHead = option("--expected-head");
const testHostBinary = resolve(option("--test-host-binary"));
const testRunnerBinary = resolve(option("--test-runner-binary"));
assert.equal(existsSync(outputRoot), false, "Acceptance output must be new.");

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const hashFile = path => sha256(readFileSync(path));
const actualHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
assert.equal(actualHead, expectedHead, "Acceptance source HEAD differs from --expected-head.");
const gitStatus = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
const trackedDiff = execFileSync("git", ["diff", "--binary", "HEAD", "--"], { cwd: root });
const untrackedSourceDigests = Object.fromEntries(gitStatus.filter(row => row.startsWith("?? ")).map(row => row.slice(3)).filter(path => existsSync(join(root, path)))
  .sort().map(path => [path, hashFile(join(root, path))]));
const metadata = path => { try { const value = lstatSync(path, { bigint: true }); return { exists: true, device: String(value.dev), inode: String(value.ino), size: String(value.size), modifiedNs: String(value.mtimeNs), changedNs: String(value.ctimeNs) }; } catch (error) { if (error?.code === "ENOENT") return { exists: false }; throw error; } };
const testHostSha256 = hashFile(testHostBinary);
const testRunnerSha256 = hashFile(testRunnerBinary);
const processRecoveryProbe = JSON.parse((await runBoundedChild(process.execPath,
  [join(prototype, "scripts", "bounded-child-process.check.mjs")], { timeoutMs: 5_000 })).stdout);
const runID = randomUUID().toLowerCase();
const isolatedHome = join(outputRoot, "isolated-home");
const tempRoot = join(outputRoot, "tmp");
const exportRoot = join(outputRoot, "exports");
const evidenceRoot = join(outputRoot, "evidence");
for (const path of [join(isolatedHome, "Library", "Application Support"), tempRoot, exportRoot, evidenceRoot]) mkdirSync(path, { recursive: true });

const protectedPaths = [join(homedir(), "Library", "Application Support", "OM0RX-xLog", "OM0RX-xLog.sqlite"), join(homedir(), "Library", "Application Support", "OM0RX-xLog-Integrated Preview", "OM0RX-xLog.sqlite")].flatMap(path => [path, `${path}-wal`, `${path}-shm`]);
const protectedBefore = Object.fromEntries(protectedPaths.map(path => [path, metadata(path)]));
const frames = [], lifecycle = [], actions = [], simulatedOutput = [], observations = [], exportAssertions = [];
let pendingExportExpectation = null;
let hostBuffer = "", sequence = 0;
const pendingHost = new Map();
process.stdin.setEncoding("utf8");
process.stdin.on("data", value => { hostBuffer += value; let nl; while ((nl = hostBuffer.indexOf("\n")) >= 0) { const row = hostBuffer.slice(0, nl); hostBuffer = hostBuffer.slice(nl + 1); const response = JSON.parse(row); const pending = pendingHost.get(response.id); assert.ok(pending, `Unexpected test-host response ${response.id}`); pendingHost.delete(response.id); pending(response); } });
function hostRequest(method, params = {}) { const request = { id: `browser-${String(++sequence).padStart(4, "0")}`, method, params }; return new Promise((resolveRequest, reject) => { const timer = setTimeout(() => { pendingHost.delete(request.id); reject(new Error(`Test-host timeout: ${method}`)); }, 20_000); pendingHost.set(request.id, response => { clearTimeout(timer); (method.startsWith("__acceptance_") ? lifecycle : frames).push({ request, response }); resolveRequest(response); }); process.stdout.write(`${JSON.stringify(request)}\n`); }); }
const successful = async (method, params = {}) => { const frame = await hostRequest(method, params); assert.equal(frame.ok, true, JSON.stringify(frame)); return frame.result; };
const health = await successful("health"); assert.deepEqual({ mode: health.mode, isolated: health.isolated_workspace, network: health.network_contact, credentials: health.credentials_accessed, station: health.station_io }, { mode: "contesting_test", isolated: true, network: false, credentials: false, station: false });
if (process.env.XLOG_OPERATOR_ACCEPTANCE_STALL === "shutdown") await successful("__acceptance_shutdown");
assert.equal((await successful("workspace_status")).workspace_exists, false);
await successful("workspace_create", { mode: "empty" });
assert.equal((await successful("workspace_status")).qso_count, 0);

async function jsonBody(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); const bytes = Buffer.concat(chunks); assert.ok(bytes.length <= 1_000_000); return JSON.parse(bytes.toString("utf8")); }
async function captureExport(prepared) {
  const fullPrepared = frames.find(frame => frame.request.method === "contest_export_prepare" && frame.response.ok &&
    frame.response.result.artifactID === prepared.artifactID)?.response.result;
  assert.ok(fullPrepared, "Native save projection did not match a prepared export frame.");
  const chunks = []; let offset = 0;
  while (offset < prepared.byteLength) {
    const frame = await successful("contest_export_read", { exportID: prepared.artifactID, sessionID: prepared.sessionID, workspaceGeneration: prepared.workspaceGeneration, offset, length: Math.min(65_536, prepared.byteLength - offset) });
    assert.equal(frame.offset, offset); const bytes = Buffer.from(frame.dataBase64, "base64"); chunks.push(bytes); offset += bytes.length; assert.equal(frame.eof, offset === prepared.byteLength);
  }
  const bytes = Buffer.concat(chunks); assert.equal(bytes.length, prepared.byteLength); assert.equal(sha256(bytes), prepared.sha256);
  assert.ok(pendingExportExpectation, "Save arrived without a bounded export expectation.");
  validateExport(bytes, fullPrepared, pendingExportExpectation.item, pendingExportExpectation.format);
  exportAssertions.push({ session: pendingExportExpectation.item.name, format: pendingExportExpectation.format,
    byteLength: bytes.length, sha256: prepared.sha256, qsoCount: fullPrepared.qsoCount, score: fullPrepared.claimedScore });
  pendingExportExpectation = null;
  const ext = prepared.format === "cabrillo" ? "log" : "adi", filename = `${prepared.sessionID}-${prepared.revision}.${ext}`, path = join(exportRoot, filename);
  writeFileSync(path, bytes, { flag: "wx" }); await successful("contest_export_release", { exportID: prepared.artifactID, sessionID: prepared.sessionID, workspaceGeneration: prepared.workspaceGeneration });
  return { status: "saved", artifactID: prepared.artifactID, sha256: prepared.sha256, filename };
}

const vite = await createViteServer({ root: prototype, appType: "mpa", server: { middlewareMode: true }, logLevel: "error" });
const server = createHTTPServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/__acceptance/worker") { const body = await jsonBody(request); response.setHeader("content-type", "application/json"); response.end(JSON.stringify(await hostRequest(body.method, body.params))); return; }
    if (request.method === "POST" && request.url === "/__acceptance/export") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(await captureExport(await jsonBody(request)))); return; }
    if (request.method === "POST" && request.url === "/__acceptance/simulated-output") { simulatedOutput.push(await jsonBody(request)); response.setHeader("content-type", "application/json"); response.end("{}"); return; }
    vite.middlewares(request, response, error => { if (error) { response.statusCode = 500; response.end("Acceptance Vite failure."); } });
  } catch (error) { process.stderr.write(`Acceptance endpoint failure: ${String(error?.stack || error)}\n`); response.statusCode = 500; response.end(JSON.stringify({ error: String(error) })); }
});
await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
const port = server.address().port, url = `http://127.0.0.1:${port}/tests/acceptance/contest-operator-worker.html`;
const session = `contest-${runID}`;
async function browser(args, record = true) {
  if (record) actions.push(args);
  const result = await runBoundedChild("agent-browser", args, { cwd: prototype,
    env: { ...process.env, AGENT_BROWSER_SESSION: session }, timeoutMs: 30_000, terminateGraceMs: 1_000 });
  return result.stdout.trim();
}
const waitText = text => browser(["wait", "--text", text]);
const waitSelector = selector => browser(["wait", selector]);
const fill = (label, value) => browser(["find", "label", label, "fill", value]);
const select = (label, value) => browser(["eval", `new Promise((resolve,reject)=>{ const until=Date.now()+10000; const poll=()=>{ const direct=[...document.querySelectorAll('select')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)}); const owner=[...document.querySelectorAll('label')].find(x=>x.firstChild?.textContent?.trim()===${JSON.stringify(label)}); const select=direct ?? owner?.querySelector('select'); if(select) { select.value=${JSON.stringify(value)}; select.dispatchEvent(new Event('change',{bubbles:true})); return resolve(true); } if(Date.now()>until) return reject(new Error('Missing select: '+${JSON.stringify(label)})); setTimeout(poll,50); }; poll(); })`]);
const click = name => browser(["find", "role", "button", "click", "--name", name]);
const waitEnabledButton = name => browser(["eval", `new Promise((resolve,reject)=>{ const until=Date.now()+10000; const poll=()=>{ const button=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(name)}); if(button && !button.disabled) return resolve(true); if(Date.now()>until) return reject(new Error('Button did not become enabled: '+${JSON.stringify(name)})); setTimeout(poll,50); }; poll(); })`]);
async function ensureArmed(expectedSession) {
  await browser(["eval", `new Promise((resolve,reject)=>{ const until=Date.now()+10000; let clicked=false; const poll=()=>{ if(!document.body.textContent.includes(${JSON.stringify(expectedSession)})) return reject(new Error('Active contest session changed')); const buttons=[...document.querySelectorAll('button')], arm=buttons.find(x=>x.textContent.trim()==='Arm simulation'), disarm=buttons.find(x=>x.textContent.trim()==='Disarm'); if(disarm && !disarm.disabled) return resolve(true); if(arm && !arm.disabled && !clicked) { clicked=true; arm.click(); } if(Date.now()>until) return reject(new Error('Operator controls did not become armed and idle')); setTimeout(poll,50); }; poll(); })`]);
}
async function openExportDialog(item) {
  await browser(["eval", `new Promise((resolve,reject)=>{ const until=Date.now()+10000; const poll=()=>{ const body=document.body.textContent; if(!body.includes(${JSON.stringify(item.name)}) || !body.includes(${JSON.stringify(item.label)})) return reject(new Error('Active contest session or profile changed before export')); const buttons=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()==='Export…'); if(buttons.length>1) return reject(new Error('Export control is not globally unique')); if(buttons[0] && !buttons[0].disabled && !document.querySelector('.contest-alert.is-uncertain')) { buttons[0].scrollIntoView({block:'center'}); buttons[0].focus(); return resolve(true); } if(Date.now()>until) return reject(new Error('Export control did not become ready without a pending receipt')); setTimeout(poll,50); }; poll(); })`]);
  await browser(["press", "Enter"]);
  await waitSelector("dialog[aria-label='Export contest log']");
}
const pressIn = async (label, key) => { await browser(["eval", `(() => { const direct=[...document.querySelectorAll('input,select,textarea')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)}); const owner=[...document.querySelectorAll('label')].find(x=>x.textContent.startsWith(${JSON.stringify(label)})); const field=direct ?? owner?.querySelector('input,select,textarea'); if(!field) throw new Error('Missing field'); field.focus(); })()`]); await browser(["press", key]); };
const text = selector => browser(["get", "text", selector]);
const expectText = async (selector, expected) => assert.match(await text(selector), expected instanceof RegExp ? expected : new RegExp(expected));
const waitScore = item => browser(["eval", `new Promise((resolve,reject)=>{ const until=Date.now()+10000; const expected=${JSON.stringify(`Claimedscore${item.expected.score}QSOs6Points${item.expected.points}Multipliers${item.expected.multipliers}`)}; const poll=()=>{ if(!document.body.textContent.includes(${JSON.stringify(item.name)})) return reject(new Error('Active contest session changed while waiting for score')); const value=document.querySelector('[aria-label="Score and multipliers"]')?.textContent??'',compact=value.replace(/\\s+/g,''); if(compact.includes(expected)) return resolve(value); if(Date.now()>until) return reject(new Error('Authoritative score did not settle: '+value)); setTimeout(poll,50); }; poll(); })`]);
async function waitForFrame(after, predicate, description) {
  const until = Date.now() + 10_000;
  while (Date.now() <= until) {
    const found = frames.slice(after).find(predicate); if (found) return found;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function utcFields(value) {
  const iso = new Date(value).toISOString();
  return { date: iso.slice(0, 10), adifDate: iso.slice(0, 10).replaceAll("-", ""), minute: iso.slice(11, 16).replace(":", ""), second: iso.slice(11, 19).replaceAll(":", "") };
}
const expectedInitialSent = (item, index) => item.serial ? String(index + 1).padStart(3, "0") : item.sentExchange;
function parseCabrillo(bytes) {
  const raw = bytes.toString("utf8");
  assert.equal(raw.replaceAll("\r\n", "").includes("\n"), false, "Cabrillo must use CRLF only.");
  const lines = raw.split("\r\n").filter(Boolean), headers = {}, qsos = [];
  for (const line of lines) {
    if (line.startsWith("QSO:")) { const parts = line.trim().split(/\s+/); assert.equal(parts.length, 11); qsos.push({ frequencyKHz: Number(parts[1]), mode: parts[2], date: parts[3], minute: parts[4], station: parts[5], sentReport: parts[6], sentExchange: parts[7], call: parts[8], receivedReport: parts[9], receivedExchange: parts[10] }); }
    else { const boundary = line.indexOf(":"); assert.ok(boundary > 0); headers[line.slice(0, boundary)] = line.slice(boundary + 1).trim(); }
  }
  return { headers, qsos };
}
function parseADIF(bytes) {
  const text = bytes.toString("utf8"), records = []; let header = {}, fields = {}, cursor = 0, sawHeader = false;
  while (cursor < text.length) {
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    if (cursor >= text.length) break;
    assert.equal(text[cursor], "<"); const close = text.indexOf(">", cursor); assert.ok(close > cursor);
    const descriptor = text.slice(cursor + 1, close).split(":"), name = descriptor[0].toUpperCase(); cursor = close + 1;
    if (name === "EOH") { header = fields; fields = {}; sawHeader = true; continue; }
    if (name === "EOR") { records.push(fields); fields = {}; continue; }
    assert.ok(descriptor[1] && /^\d+$/.test(descriptor[1]), `Missing ADIF length for ${name}.`);
    const length = Number(descriptor[1]), value = text.slice(cursor, cursor + length); assert.equal(Buffer.byteLength(value), length); cursor += length; fields[name] = value;
  }
  assert.equal(sawHeader, true); assert.deepEqual(fields, {}); return { header, records };
}
function validateExport(bytes, prepared, item, format) {
  assert.equal(prepared.format, format); assert.equal(prepared.qsoCount, item.contacts.length);
  assert.deepEqual({ points: prepared.totalPoints, multipliers: prepared.multiplierCount, score: prepared.claimedScore }, item.expected);
  const expectedMode = item.mode === "CW" ? "CW" : "SSB", cabrilloMode = item.mode === "CW" ? "CW" : "PH";
  if (format === "cabrillo") {
    const parsed = parseCabrillo(bytes); assert.equal(parsed.headers.CONTEST, item.cabrilloName); assert.equal(parsed.headers.CALLSIGN, item.station.call);
    if (item.family === "jidx") assert.equal(parsed.headers.CATEGORY, "ABL");
    else assert.equal(parsed.headers["CATEGORY-MODE"], expectedMode);
    assert.equal(Number(parsed.headers["CLAIMED-SCORE"]), item.expected.score); assert.equal(parsed.headers.NAME, "Oliver Acceptance");
    assert.equal(parsed.qsos.length, item.contacts.length);
    parsed.qsos.forEach((qso, index) => { const contact = item.contacts[index], committed = item.commits[index].qso,
      expectedSent = expectedInitialSent(item, index), time = utcFields(committed.workedAt ?? committed.originalUTC); assert.equal(committed.sentExchange, expectedSent);
      assert.deepEqual(qso, { frequencyKHz: Math.round(contact.frequency / 1_000), mode: cabrilloMode, date: time.date, minute: time.minute,
        station: item.station.call, sentReport: item.report || item.station.sentParts[0], sentExchange: item.report ? expectedSent : item.station.sentParts[1],
        call: contact.call, receivedReport: (contact.receivedReport ?? item.report) || contact.receivedParts[0],
        receivedExchange: item.report ? (item.family === "oceania" ? contact.receivedAggregate.padStart(2, "0") : contact.receivedAggregate) : contact.receivedParts[1] }); });
  } else {
    const parsed = parseADIF(bytes); assert.equal(parsed.header.ADIF_VER, "3.1.7"); assert.equal(parsed.header.PROGRAMID, "OM0RX-xLog"); assert.equal(parsed.records.length, item.contacts.length);
    parsed.records.forEach((record, index) => { const contact = item.contacts[index], committed = item.commits[index].qso,
      expectedSent = expectedInitialSent(item, index), time = utcFields(committed.workedAt ?? committed.originalUTC); assert.equal(committed.sentExchange, expectedSent);
      assert.equal(record.CALL, contact.call); assert.equal(record.CONTEST_ID, item.adifContestID ?? item.cabrilloName); assert.equal(record.MODE, expectedMode);
      assert.equal(record.BAND, contact.band); assert.equal(record.FREQ, (contact.frequency / 1_000_000).toFixed(6)); assert.equal(record.QSO_DATE, time.adifDate); assert.equal(record.TIME_ON, time.second);
      assert.equal(record.RST_SENT, item.report || undefined); assert.equal(record.RST_RCVD, (contact.receivedReport ?? item.report) || undefined); assert.equal(record.STATION_CALLSIGN, item.station.call); assert.equal(record.OPERATOR, item.station.call);
      assert.equal(record.STX_STRING, expectedSent); assert.equal(record.SRX_STRING, contact.rx);
      if (item.numericADIF) { assert.equal(record.STX, String(Number(expectedSent))); assert.equal(record.SRX, String(Number(contact.receivedAggregate))); }
      else { assert.equal(record.STX, undefined); assert.equal(record.SRX, undefined); }
      for (const [field, value] of Object.entries(contact.adif ?? {})) assert.equal(record[field], value);
    });
  }
}

const profiles = [
  { family: "cq-ww", id: "cq-ww-cw", cabrilloName: "CQ-WW-CW", label: "CQ WW CW", mode: "CW", report: "599", sentExchange: "15", expected: { points: 14, multipliers: 12, score: 168 } },
  { family: "cq-ww", id: "cq-ww-ssb", cabrilloName: "CQ-WW-SSB", label: "CQ WW SSB", mode: "SSB", report: "59", sentExchange: "15", expected: { points: 14, multipliers: 12, score: 168 } },
  { family: "cq-wpx", id: "cq-wpx-cw", cabrilloName: "CQ-WPX-CW", label: "CQ WPX CW", mode: "CW", report: "599", serial: true, numericADIF: true, expected: { points: 21, multipliers: 3, score: 63 } },
  { family: "cq-wpx", id: "cq-wpx-ssb", cabrilloName: "CQ-WPX-SSB", label: "CQ WPX SSB", mode: "SSB", report: "59", serial: true, numericADIF: true, expected: { points: 21, multipliers: 3, score: 63 } },
  { family: "oceania", id: "oceania-dx-cw", cabrilloName: "OCEANIA-DX-CW", label: "Oceania DX CW", mode: "CW", report: "599", serial: true, expected: { points: 18, multipliers: 6, score: 108 } },
  { family: "oceania", id: "oceania-dx-ssb", cabrilloName: "OCEANIA-DX-SSB", label: "Oceania DX SSB", mode: "SSB", report: "59", serial: true, expected: { points: 18, multipliers: 6, score: 108 } },
  { family: "sac", id: "sac-cw", cabrilloName: "SAC-CW", label: "SAC CW", mode: "CW", report: "599", serial: true, expected: { points: 16, multipliers: 6, score: 96 } },
  { family: "sac", id: "sac-ssb", cabrilloName: "SAC-SSB", label: "SAC SSB", mode: "SSB", report: "59", serial: true, expected: { points: 16, multipliers: 6, score: 96 } },
  { family: "naqp", id: "naqp-cw", cabrilloName: "NAQP-CW", label: "NAQP CW", mode: "CW", report: "", sentExchange: "AL CA", expected: { points: 6, multipliers: 6, score: 36 } },
  { family: "naqp", id: "naqp-ssb", cabrilloName: "NAQP-SSB", label: "NAQP SSB", mode: "SSB", report: "", sentExchange: "AL CA", expected: { points: 6, multipliers: 6, score: 36 } },
  { family: "jidx", id: "jidx-cw", cabrilloName: "JIDX-CW", label: "JIDX CW", mode: "CW", report: "599", sentExchange: "15", numericADIF: true, expected: { points: 6, multipliers: 6, score: 36 } },
  { family: "jidx", id: "jidx-ssb", cabrilloName: "JIDX-PH", adifContestID: "JIDX-SSB", label: "JIDX SSB", mode: "SSB", report: "59", sentExchange: "15", numericADIF: true, expected: { points: 6, multipliers: 6, score: 36 } },
  { family: "arrl-dx", id: "arrl-dx-cw", cabrilloName: "ARRL-DX-CW", label: "ARRL DX CW", mode: "CW", report: "599", sentExchange: "K", expected: { points: 18, multipliers: 6, score: 108 } },
  { family: "arrl-dx", id: "arrl-dx-ssb", cabrilloName: "ARRL-DX-SSB", label: "ARRL DX SSB", mode: "SSB", report: "59", sentExchange: "K", expected: { points: 18, multipliers: 6, score: 108 } },
];
const expectedProgress = {
  "cq-ww": [[3, 2, 6], [4, 4, 16], [7, 6, 42], [10, 8, 80], [11, 10, 110], [14, 12, 168]],
  "cq-wpx": [[3, 1, 3], [4, 2, 8], [7, 3, 21], [13, 3, 39], [15, 3, 45], [21, 3, 63]],
  oceania: [[1, 1, 1], [2, 2, 4], [3, 3, 9], [8, 4, 32], [13, 5, 65], [18, 6, 108]],
  sac: [[3, 1, 3], [5, 2, 10], [8, 3, 24], [11, 4, 44], [13, 5, 65], [16, 6, 96]],
  naqp: [[1, 1, 1], [2, 2, 4], [3, 3, 9], [4, 4, 16], [5, 5, 25], [6, 6, 36]],
  jidx: [[1, 1, 1], [2, 2, 4], [3, 3, 9], [4, 4, 16], [5, 5, 25], [6, 6, 36]],
  "arrl-dx": [[3, 1, 3], [6, 2, 12], [9, 3, 27], [12, 4, 48], [15, 5, 75], [18, 6, 108]],
};
const station = family => family === "sac" ? { call: "SM0AAA", cq: "14", entity: "Sweden", sentParts: [] } :
  family === "naqp" ? { call: "K1AAA", cq: "5", entity: "United States", sentParts: ["AL", "CA"], createFields: { "Station name": "AL", "Station location": "CA" } } :
  family === "jidx" ? { call: "OM0RX", cq: "15", entity: "Slovak Republic", sentParts: ["599", "15"], createFields: { "Station prefecture or CQ Zone": "15" } } :
  family === "arrl-dx" ? { call: "OM0RX", cq: "15", entity: "Slovak Republic", sentParts: ["599", "K"], createFields: { "Station power (DX)": "K", "Cabrillo section": "DX" } } :
  { call: "OM0RX", cq: "15", entity: "Slovak Republic", sentParts: [] };
const contactsFor = profile => {
  if (profile.family === "cq-ww") return [
    { call: "K1ABC", receivedAggregate: "05" }, { call: "DL1ABC", receivedAggregate: "14" }, { call: "JA1AAA", receivedAggregate: "25" },
    { call: "K1ABC", receivedAggregate: "05" }, { call: "DL1ABC", receivedAggregate: "14" }, { call: "JA1AAA", receivedAggregate: "25" },
  ];
  if (profile.family === "cq-wpx") return ["123", "124", "125", "126", "127", "128"].map((receivedAggregate, index) =>
    ({ call: ["K1ABC", "DL1ABC", "JA1AAA"][index % 3], receivedAggregate }));
  if (profile.family === "oceania") return ["7", "8", "9", "10", "11", "12"].map((receivedAggregate, index) =>
    ({ call: ["VK1AAA", "VK2BBB", "VK3CCC"][index % 3], receivedAggregate }));
  if (profile.family === "sac") return ["1", "2", "3", "4", "5", "6"].map((receivedAggregate, index) =>
    ({ call: ["K1ABC", "DL1ABC", "JA1AAA"][index % 3], receivedAggregate }));
  if (profile.family === "naqp") return [
    { call: "K2AAA", receivedAggregate: "BOB CT", fields: { "Received Name": "BOB", "Received Location": "CT" }, adif: { NAME: "BOB", STATE: "CT", MY_NAME: "AL", MY_STATE: "CA" } },
    { call: "VE3AAA", receivedAggregate: "SAM ON", fields: { "Received Name": "SAM", "Received Location": "ON" }, adif: { NAME: "SAM", STATE: "ON", MY_NAME: "AL", MY_STATE: "CA" } },
    { call: "KH6AAA", receivedAggregate: "KAI HI", fields: { "Received Name": "KAI", "Received Location": "HI" }, adif: { NAME: "KAI", STATE: "HI", MY_NAME: "AL", MY_STATE: "CA" } },
    { call: "K2AAA", receivedAggregate: "BOB CT", fields: { "Received Name": "BOB", "Received Location": "CT" }, adif: { NAME: "BOB", STATE: "CT", MY_NAME: "AL", MY_STATE: "CA" } },
    { call: "VE3AAA", receivedAggregate: "SAM ON", fields: { "Received Name": "SAM", "Received Location": "ON" }, adif: { NAME: "SAM", STATE: "ON", MY_NAME: "AL", MY_STATE: "CA" } },
    { call: "KH6AAA", receivedAggregate: "KAI HI", fields: { "Received Name": "KAI", "Received Location": "HI" }, adif: { NAME: "KAI", STATE: "HI", MY_NAME: "AL", MY_STATE: "CA" } },
  ];
  if (profile.family === "jidx") return [
    { call: "JA1AAA", receivedAggregate: "10", fields: { "Received Prefecture or CQ Zone": "10" }, adif: { STX_STRING: "15", SRX_STRING: "10" } },
    { call: "JA2BBB", receivedAggregate: "20", fields: { "Received Prefecture or CQ Zone": "20" }, adif: { STX_STRING: "15", SRX_STRING: "20" } },
    { call: "JA3CCC", receivedAggregate: "30", fields: { "Received Prefecture or CQ Zone": "30" }, adif: { STX_STRING: "15", SRX_STRING: "30" } },
    { call: "JA1AAA", receivedAggregate: "10", fields: { "Received Prefecture or CQ Zone": "10" }, adif: { STX_STRING: "15", SRX_STRING: "10" } },
    { call: "JA2BBB", receivedAggregate: "20", fields: { "Received Prefecture or CQ Zone": "20" }, adif: { STX_STRING: "15", SRX_STRING: "20" } },
    { call: "JA3CCC", receivedAggregate: "30", fields: { "Received Prefecture or CQ Zone": "30" }, adif: { STX_STRING: "15", SRX_STRING: "30" } },
  ];
  return [
    { call: "K1ABC", receivedAggregate: "CT", fields: { "Received State or province": "CT" }, adif: { STATE: "CT" } },
    { call: "W6AAA", receivedAggregate: "CA", fields: { "Received State or province": "CA" }, adif: { STATE: "CA" } },
    { call: "VE3AAA", receivedAggregate: "ON", fields: { "Received State or province": "ON" }, adif: { STATE: "ON" } },
    { call: "K1ABC", receivedAggregate: "CT", fields: { "Received State or province": "CT" }, adif: { STATE: "CT" } },
    { call: "W6AAA", receivedAggregate: "CA", fields: { "Received State or province": "CA" }, adif: { STATE: "CA" } },
    { call: "VE3AAA", receivedAggregate: "ON", fields: { "Received State or province": "ON" }, adif: { STATE: "ON" } },
  ];
};
const allCases = profiles.map(profile => {
  const itemStation = station(profile.family), contacts = contactsFor(profile).map((contact, index) => ({
    ...contact, style: index < 3 ? "run" : "search-and-pounce",
    frequency: index < 3 ? (profile.mode === "CW" ? 14_025_000 + index * 1_000 : 14_250_000 + index * 1_000) :
      (profile.mode === "CW" ? 7_025_000 + (index - 3) * 1_000 : 7_140_000 + (index - 3) * 1_000),
    band: index < 3 ? "20m" : "40m", rx: contact.receivedAggregate, receivedReport: profile.report || undefined,
    receivedParts: profile.report ? [profile.report, contact.receivedAggregate] : contact.receivedAggregate.split(" "),
  }));
  itemStation.sentParts = profile.report ? [profile.report, profile.serial ? "001" : profile.sentExchange] : itemStation.sentParts;
  return { ...profile, station: itemStation, name: `${profile.label} family operator acceptance`, commits: [], contacts };
});
const diagnosticProfile = process.env.XLOG_FAMILY_DIAGNOSTIC_PROFILE ?? "";
assert.ok(!diagnosticProfile || allCases.some(item => item.id === diagnosticProfile), "Diagnostic profile must name a reviewed family profile.");
const cases = diagnosticProfile ? allCases.filter(item => item.id === diagnosticProfile) : allCases;

async function exportDOMState(item, phase) {
  const state = JSON.parse(await browser(["eval", `(() => { const buttons=[...document.querySelectorAll('button')].filter(x=>x.textContent.trim()==='Export…'); const button=buttons[0], rect=button?.getBoundingClientRect(); return JSON.stringify({phase:${JSON.stringify(phase)},expectedSession:${JSON.stringify(item.name)},heading:document.querySelector('.contest-header h1')?.textContent?.trim()??null,sessionPresent:document.body.textContent.includes(${JSON.stringify(item.name)}),profilePresent:document.body.textContent.includes(${JSON.stringify(item.label)}),buttons:buttons.map(x=>({disabled:x.disabled,connected:x.isConnected,rect:{x:x.getBoundingClientRect().x,y:x.getBoundingClientRect().y,width:x.getBoundingClientRect().width,height:x.getBoundingClientRect().height}})),alert:document.querySelector('.contest-alert')?.textContent?.trim()??null,dialogs:[...document.querySelectorAll('[role=dialog]')].map(x=>x.textContent?.trim()),active:document.activeElement?.textContent?.trim()??document.activeElement?.getAttribute('aria-label')??null,hit:rect?[...document.elementsFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)].slice(0,5).map(x=>({tag:x.tagName,class:x.className,text:x.textContent?.trim().slice(0,80)})):[]}); })()`]));
  observations.push({ case: item.id, phase: `export-${phase}`, state });
}

async function exportCase(item, format) {
  await exportDOMState(item, `${format}-before`);
  await openExportDialog(item); await select("Format", format);
  await exportDOMState(item, `${format}-dialog-open`);
  const locationSelector = '.contest-export-fields input[maxlength="64"][required]';
  const nameSelector = '.contest-export-fields input[maxlength="75"][required]';
  const expectedLocation = item.family === "naqp" ? "CA" : "DX";
  if (await browser(["get", "value", `dialog[open] ${locationSelector}`]) !== expectedLocation) {
    await browser(["fill", `dialog[open] ${locationSelector}`, expectedLocation]);
  }
  await browser(["fill", `dialog[open] ${nameSelector}`, "Oliver Acceptance"]);
  assert.equal(await browser(["get", "value", `dialog[open] ${locationSelector}`]), expectedLocation);
  assert.equal(await browser(["get", "value", `dialog[open] ${nameSelector}`]), "Oliver Acceptance");
  const prepareStart = frames.length; await waitEnabledButton("Prepare export"); await click("Prepare export");
  const preparedFrame = await waitForFrame(prepareStart, frame => frame.request.method === "contest_export_prepare", `export preparation ${item.name}/${format}`);
  assert.equal(preparedFrame.response.ok, true, JSON.stringify(preparedFrame.response.error));
  await waitSelector("[aria-label='Prepared export summary']");
  const practicePreview = ["sac", "jidx", "arrl-dx"].includes(item.family);
  await expectText("[aria-label='Prepared export summary']", format === "cabrillo" ?
    (practicePreview ? /Cabrillo practice export/ : /Cabrillo submission preview/) : /ADIF compatibility export/);
  const assertionCount = exportAssertions.length; pendingExportExpectation = { item, format }; await click("Save…");
  const until = Date.now() + 10_000; while (exportAssertions.length === assertionCount && Date.now() <= until) await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
  assert.equal(exportAssertions.length, assertionCount + 1, `Export save did not complete for ${item.name} ${format}.`); await waitText("Saved"); await waitText("Plain Log");
}

async function createCase(item) {
  await fill("Session name", item.name); await select("Contest", item.id); await fill("Station callsign", item.station.call);
  await fill("Operator callsign", item.station.call); await fill("CQ zone", item.station.cq); await fill("DXCC entity", item.station.entity);
  for (const [label, value] of Object.entries(item.station.createFields ?? {})) await fill(label, value);
  await waitEnabledButton("Create and open"); const createStart = frames.length;
  await pressIn(Object.keys(item.station.createFields ?? {}).at(-1) ?? "DXCC entity", "Enter");
  await waitForFrame(createStart, frame => frame.request.method === "contest_create" && frame.response.ok, `create ${item.name}`);
  await waitText("Plain Log");
  for (const [index, contact] of item.contacts.entries()) {
    const style = contact.style;
    await select("Operating style", style); await fill("Frequency Hz", String(contact.frequency)); await select("Band", contact.band);
    if (style === "run") {
      await ensureArmed(item.name);
      const outputStart = simulatedOutput.length; await pressIn("Contest callsign", "Enter");
      const until = Date.now() + 10_000; while (!simulatedOutput.slice(outputStart).some(entry => entry.macro === "CQ") && Date.now() <= until) await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
      assert.equal(simulatedOutput.slice(outputStart).some(entry => entry.macro === "CQ"), true, `Blank CQ did not settle for ${item.name}.`);
    }
    await fill("Contest callsign", contact.call); if (item.report) await fill("Received report", item.report);
    await ensureArmed(item.name);
    const callOutputStart = simulatedOutput.length; await pressIn("Contest callsign", "Enter");
    const callMacro = style === "run" ? "HISCALL" : "MYCALL";
    const callUntil = Date.now() + 10_000; while (!simulatedOutput.slice(callOutputStart).some(entry => entry.macro === callMacro) && Date.now() <= callUntil) await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
    assert.equal(simulatedOutput.slice(callOutputStart).some(entry => entry.macro === callMacro), true, `Call-first output did not settle for ${item.name}/${style}.`);
    const exercisesInvalidExchange = index === 0 || index === 3;
    if (exercisesInvalidExchange) {
      const before = frames.filter(frame => frame.request.method === "contest_qso_commit" && frame.response.ok).length;
      const invalid = item.family === "naqp" ? { "Received Name": "BOB", "Received Location": "ZZ" } :
        item.family === "jidx" ? { "Received Prefecture or CQ Zone": "99" } :
        item.family === "arrl-dx" ? { "Received State or province": "ZZ" } :
        { "Received exchange": item.family === "cq-ww" ? "99" : "0" };
      const after = frames.length; for (const [label, value] of Object.entries(invalid)) await fill(label, value);
      const invalidFrame = await waitForFrame(after, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
        frame.response.result.draft.validation.errors.length > 0,
      `authoritative invalid ${item.id} draft`);
      const blocked = { simulated: simulatedOutput.length,
        reserves: frames.filter(frame => frame.request.method === "contest_serial_reserve").length,
        commits: frames.filter(frame => frame.request.method === "contest_qso_commit").length };
      await pressIn(Object.keys(invalid).at(-1), "Enter");
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
      assert.deepEqual({ simulated: simulatedOutput.length,
        reserves: frames.filter(frame => frame.request.method === "contest_serial_reserve").length,
        commits: frames.filter(frame => frame.request.method === "contest_qso_commit").length }, blocked);
      observations.push({ case: item.id, contact: index, phase: "authoritative-invalid-received-exchange-blocked",
        validation: invalidFrame.response.result.draft.validation.errors,
        operator: await text("[aria-label='Run and S&P simulation']") });
    }
    const validExchangeStart = frames.length;
    for (const [label, value] of Object.entries(contact.fields ?? { "Received exchange": contact.receivedAggregate })) await fill(label, value);
    await waitForFrame(validExchangeStart, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
      frame.response.result.draft.fields.receivedExchange === contact.receivedAggregate,
    `authoritative received exchange ${item.id} ${index}`);
    if (exercisesInvalidExchange) await pressIn(Object.keys(contact.fields ?? { "Received exchange": contact.receivedAggregate }).at(-1), "Escape");
    await ensureArmed(item.name); await new Promise(resolveDelay => setTimeout(resolveDelay, 100));
    observations.push({ case: item.id, contact: index, phase: "before-enter", operator: await text("[aria-label='Run and S&P simulation']") });
    const commitStart = frames.length;
    if (exercisesInvalidExchange) {
      const outputStart = simulatedOutput.length; await pressIn("Contest callsign", "Enter");
      const until = Date.now() + 10_000; while (!simulatedOutput.slice(outputStart).some(entry => entry.macro === callMacro) && Date.now() <= until) await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
      assert.equal(simulatedOutput.slice(outputStart).some(entry => entry.macro === callMacro), true, `Rearmed call-first output did not settle for ${item.name}/${style}.`);
      await waitEnabledButton("Disarm");
    }
    if (style === "run") {
      const outputStart = simulatedOutput.length; await pressIn("Contest callsign", "Enter");
      const until = Date.now() + 10_000; while (!simulatedOutput.slice(outputStart).some(entry => entry.macro === "EXCH") && Date.now() <= until) await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
      assert.equal(simulatedOutput.slice(outputStart).some(entry => entry.macro === "EXCH"), true, `Run exchange did not settle for ${item.name} ${index}.`);
      await waitEnabledButton("Disarm");
    }
    await pressIn(Object.keys(contact.fields ?? { "Received exchange": contact.receivedAggregate }).at(-1), "Enter");
    const committed = await waitForFrame(commitStart, frame => frame.request.method === "contest_qso_commit" && frame.response.ok, `commit ${item.name} ${index}`);
    item.commits.push(committed.response.result);
    const [points, multipliers, score] = expectedProgress[item.family][index];
    assert.deepEqual({ qsoCount: committed.response.result.score.qsos, points: committed.response.result.score.points,
      multipliers: committed.response.result.score.multipliers, score: committed.response.result.score.claimedScore },
    { qsoCount: index + 1, points, multipliers, score });
    await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
    observations.push({ case: item.id, contact: index, phase: "after-enter", operator: await text("[aria-label='Run and S&P simulation']") });
    await waitText(`${index + 1} contacts`);
    if (style === "run") {
      const cqStart = simulatedOutput.length; await pressIn("Contest callsign", "Enter");
      const until = Date.now() + 10_000; while (!simulatedOutput.slice(cqStart).some(entry => entry.macro === "CQ") && Date.now() <= until) await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
      assert.equal(simulatedOutput.slice(cqStart).some(entry => entry.macro === "CQ"), true, `Next blank CQ did not settle after ${item.name} Run contact ${index}.`);
    }
  }
  for (const duplicateIndex of [0, 3]) {
    const duplicate = item.contacts[duplicateIndex], beforeDuplicate = {
      commits: frames.filter(frame => frame.request.method === "contest_qso_commit").length,
      reserves: frames.filter(frame => frame.request.method === "contest_serial_reserve").length,
      output: simulatedOutput.length,
    };
    await select("Operating style", duplicate.style); await fill("Frequency Hz", String(duplicate.frequency)); await select("Band", duplicate.band);
    await fill("Contest callsign", duplicate.call); if (item.report) await fill("Received report", item.report);
    await waitText("Duplicate"); await ensureArmed(item.name); await pressIn("Contest callsign", "Enter"); await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
    assert.equal(frames.filter(frame => frame.request.method === "contest_qso_commit").length, beforeDuplicate.commits);
    assert.equal(frames.filter(frame => frame.request.method === "contest_serial_reserve").length, beforeDuplicate.reserves);
    assert.equal(simulatedOutput.length, beforeDuplicate.output + 1); assert.equal(simulatedOutput.at(-1)?.macro, "QSOB4");
    observations.push({ case: item.id, style: duplicate.style, phase: "call-first-duplicate-blocked",
      operator: await text("[aria-label='Run and S&P simulation']") });
    await pressIn("Contest callsign", "Escape");
  }
  const resetStart = frames.length;
  await browser(["fill", ".contest-entry-fields input[aria-label='Contest callsign']", "X"]);
  await browser(["press", "Backspace"]);
  await waitForFrame(resetStart, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
    frame.response.result.draft.fields.callsign === "", `clean draft after ${item.name} duplicate probes`);
  await waitScore(item);
  await browser(["screenshot", "--full", join(evidenceRoot, `${item.id}-both-styles.png`)]);
  await exportCase(item, "cabrillo"); await exportCase(item, "adif");
  await click("Contest Manager"); await waitText("Contest sessions");
}

async function openSession(item) {
  await browser(["eval", `(() => { const button=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${JSON.stringify(item.name)})); if(!button) throw new Error('Missing session button'); button.click(); })()`]);
  await waitText("Plain Log");
}

let primaryFailure = null;
try {
  await browser(["open", url]); await waitText("Contest Workspace");
  for (const item of cases) await createCase(item);
  await successful("__acceptance_restart"); await waitText(cases[0].name);
  for (const item of cases) {
    await openSession(item); await expectText("[aria-label='Contest log']", /6 contacts/);
    if (item.serial) {
      const reserveStart = frames.length; await click("Reserve serial");
      const reserve = await waitForFrame(reserveStart, frame => frame.request.method === "contest_serial_reserve" && frame.response.ok,
        `${item.id} post-restart serial reservation`);
      assert.equal(reserve.response.result.draft.reservedSerial, 7); await waitText("Serial 7");
    }
    await click(`Edit ${item.contacts[0].call}`); await waitText("Update the contact");
    const correctionLabel = item.family === "naqp" ? "Received Name" : item.report ? "Received report" : "Received exchange";
    const correctionValue = item.family === "naqp" ? "ROBERT" : item.mode === "CW" ? "579" : "57";
    await browser(["eval", `(() => { const root=document.querySelector('.contest-qso-editor'); const label=[...root.querySelectorAll('label')].find(x=>x.textContent.startsWith(${JSON.stringify(correctionLabel)})); const input=label?.querySelector('input'); if(!input) throw new Error('Missing correction field'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,${JSON.stringify(correctionValue)}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`]);
    await fill("Correction note", `Synthetic ${item.id} family correction`); const correctionStart = frames.length; await click("Save correction");
    const correction = await waitForFrame(correctionStart, frame => frame.request.method === "contest_qso_correct" && frame.response.ok, `${item.id} correction receipt`);
    const target = correction.response.result.currentTarget;
    if (item.family === "naqp") assert.equal(target.receivedExchangeFields.name, "ROBERT");
    else { assert.equal(target.receivedReport, correctionValue); item.contacts[0] = { ...item.contacts[0], receivedReport: correctionValue }; }
    await waitScore(item);
    item.commits[0] = { ...item.commits[0], qso: target };
    if (item.family === "naqp") {
      item.contacts[0] = { ...item.contacts[0], receivedAggregate: `ROBERT ${item.contacts[0].receivedParts[1]}`,
        receivedParts: ["ROBERT", item.contacts[0].receivedParts[1]], rx: `ROBERT ${item.contacts[0].receivedParts[1]}`,
        adif: { ...item.contacts[0].adif, NAME: "ROBERT" } };
    }
    await exportCase(item, "cabrillo"); await exportCase(item, "adif");
    observations.push({ case: item.id, phase: "restart-correction", revision: correction.response.result.session.revision,
      score: correction.response.result.score.claimedScore });
    await click("Contest Manager"); await waitText("Contest sessions");
  }
  await browser(["close"], false);
  const status = await successful("workspace_status"); assert.deepEqual({ qso: status.qso_count, pending: status.pending_sync_count, outbox: status.outbox_count }, { qso: 0, pending: 0, outbox: 0 });
  assert.equal(simulatedOutput.some(item => item.macro === "CQ"), true); assert.equal(simulatedOutput.some(item => item.macro === "EXCH"), true);
  const commits = frames.filter(item => item.request.method === "contest_qso_commit" && item.response.ok).map(item => item.response.result);
  assert.equal(commits.length, cases.length * 6);
  for (const item of cases.filter(item => item.serial)) assert.deepEqual(item.commits.map(result => result.qso.sentExchange), ["001", "002", "003", "004", "005", "006"]);
  assert.equal(exportAssertions.length, cases.length * 4);
} catch (error) { primaryFailure = error; }
finally { try { await browser(["close"], false); } catch {} try { await successful("__acceptance_shutdown"); } catch {} try { await vite.close(); } catch {} await new Promise(resolveClose => server.close(resolveClose)); }

const inventory = rootPath => { const rows = []; const visit = (path, relative) => { const value = lstatSync(path); assert.equal(value.isSymbolicLink(), false); if (value.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name), relative ? `${relative}/${name}` : name); else rows.push({ path: relative, size: value.size, sha256: hashFile(path) }); }; visit(rootPath, ""); return rows; };
const protectedAfter = Object.fromEntries(protectedPaths.map(path => [path, metadata(path)]));
if (primaryFailure === null) { try { assert.deepEqual(protectedAfter, protectedBefore, "Protected production database metadata changed."); } catch (error) { primaryFailure = error; } }
const evidence = { schemaVersion: 2, ok: primaryFailure === null, boundary: "Headless Vite UI driving a SwiftPM test host around the real isolated LiveWorker; not a packaged worker/app, native window, RF, audio, PTT, hardware, or sponsor-submission acceptance.", source: { expectedHead, actualHead, dirty: gitStatus.length > 0, status: gitStatus, trackedDiffBytes: trackedDiff.length, trackedDiffSha256: sha256(trackedDiff), untrackedSourceDigests }, testHost: { path: testHostBinary, sha256: testHostSha256 }, testRunner: { path: testRunnerBinary, sha256: testRunnerSha256 }, processRecoveryProbe, runID, url, cases, actions, observations, simulatedOutput, lifecycle, frameCount: frames.length, frames, exportAssertions, exports: inventory(exportRoot), syntheticInventory: inventory(isolatedHome), protectedDatabaseMetadataUnchanged: JSON.stringify(protectedAfter) === JSON.stringify(protectedBefore), failure: primaryFailure ? String(primaryFailure.stack || primaryFailure) : null };
writeFileSync(join(evidenceRoot, "acceptance.json"), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdin.destroy();
if (primaryFailure) throw primaryFailure;
assert.ok(frames.length > 0);
process.stderr.write(`${JSON.stringify({ ok: true, sourceHead: expectedHead, testHostSha256, frames: frames.length, exports: evidence.exports.length, evidence: join(evidenceRoot, "acceptance.json") })}\n`);
