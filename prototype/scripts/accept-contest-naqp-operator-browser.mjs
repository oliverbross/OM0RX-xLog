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
const fixtureRoot = join(outputRoot, "fixtures");
for (const path of [join(isolatedHome, "Library", "Application Support"), tempRoot, exportRoot, evidenceRoot, fixtureRoot]) mkdirSync(path, { recursive: true });
writeFileSync(join(fixtureRoot, "acceptance-valid.scp"), "!!Order,1,1\nVE3AAA\nKH6AAA\nHI8A\nK2AAA\nVE3BBB\nDL1AAA\n", { flag: "wx" });
writeFileSync(join(fixtureRoot, "acceptance-invalid.scp"), "!!Order,1,1\nß1\n", { flag: "wx" });

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
    if (request.method === "POST" && request.url === "/__acceptance/scp-import") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(await hostRequest("__acceptance_scp_import", { selector: "valid" }))); return; }
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
    env: { ...process.env, AGENT_BROWSER_SESSION: session }, timeoutMs: 20_000, terminateGraceMs: 1_000 });
  return result.stdout.trim();
}
const waitText = text => browser(["wait", "--text", text]);
const fill = (label, value) => browser(["find", "label", label, "fill", value]);
const select = (label, value) => browser(["eval", `(() => { const direct=[...document.querySelectorAll('select')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)}); const owner=[...document.querySelectorAll('label')].find(x=>x.firstChild?.textContent?.trim()===${JSON.stringify(label)}); const select=direct ?? owner?.querySelector('select'); if(!select) throw new Error('Missing select'); select.value=${JSON.stringify(value)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`]);
const fillDialog = (selector, value) => browser(["fill", `dialog[open] ${selector}`, value]);
const click = name => browser(["find", "role", "button", "click", "--name", name]);
const waitEnabledButton = name => browser(["eval", `new Promise((resolve,reject)=>{ const until=Date.now()+10000; const poll=()=>{ const button=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(name)}); if(button && !button.disabled) return resolve(true); if(Date.now()>until) return reject(new Error('Button did not become enabled: '+${JSON.stringify(name)})); setTimeout(poll,50); }; poll(); })`]);
async function openManager() { await waitEnabledButton("Contest Manager"); await click("Contest Manager"); await waitText("Contest sessions"); }
const waitEnabledField = label => browser(["eval", `new Promise((resolve,reject)=>{ const until=Date.now()+10000; const poll=()=>{ const direct=[...document.querySelectorAll('input,select,textarea')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)}),owner=[...document.querySelectorAll('label')].find(x=>x.textContent.startsWith(${JSON.stringify(label)})),field=direct ?? owner?.querySelector('input,select,textarea'); if(field && !field.disabled) return resolve(true); if(Date.now()>until) return reject(new Error('Field did not become enabled: '+${JSON.stringify(label)})); setTimeout(poll,50); }; poll(); })`]);
const pressIn = async (label, key) => { await browser(["eval", `(() => { const direct=[...document.querySelectorAll('input,select,textarea')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)}); const owner=[...document.querySelectorAll('label')].find(x=>x.textContent.startsWith(${JSON.stringify(label)})); const field=direct ?? owner?.querySelector('input,select,textarea'); if(!field) throw new Error('Missing field'); field.focus(); })()`]); await browser(["press", key]); };
const text = selector => browser(["get", "text", selector]);
const expectText = async (selector, expected) => assert.match(await text(selector), expected instanceof RegExp ? expected : new RegExp(expected));
const waitMatchingText = (selector, pattern) => browser(["eval", `new Promise((resolve,reject)=>{ const until=Date.now()+10000,pattern=new RegExp(${JSON.stringify(pattern)},'s'); const poll=()=>{ const value=document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''; if(pattern.test(value)) return resolve(value); if(Date.now()>until) return reject(new Error('Text did not match '+pattern+': '+value)); setTimeout(poll,50); }; poll(); })`]);
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
function parseCabrillo(bytes) {
  const raw = bytes.toString("utf8");
  assert.equal(raw.replaceAll("\r\n", "").includes("\n"), false, "Cabrillo must use CRLF only.");
  const lines = raw.split("\r\n").filter(Boolean), headers = {}, qsos = [];
  for (const line of lines) {
    if (line.startsWith("QSO:")) { const parts = line.trim().split(/\s+/); assert.equal(parts.length, 11); qsos.push({ frequencyKHz: Number(parts[1]), mode: parts[2], date: parts[3], minute: parts[4], station: parts[5], sentName: parts[6], sentLocation: parts[7], call: parts[8], receivedName: parts[9], receivedLocation: parts[10] }); }
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
  const cabrilloMode = item.mode === "CW" ? "CW" : item.mode === "SSB" ? "PH" : "RY";
  if (format === "cabrillo") {
    const parsed = parseCabrillo(bytes); assert.equal(parsed.headers.CONTEST, item.id.toUpperCase()); assert.equal(parsed.headers.CALLSIGN, item.stationCall);
    assert.equal(parsed.headers["CATEGORY-MODE"], item.mode); assert.equal(Number(parsed.headers["CLAIMED-SCORE"]), item.expected.score); assert.equal(parsed.headers.NAME, "Oliver Acceptance");
    assert.equal(parsed.qsos.length, item.contacts.length);
    parsed.qsos.forEach((qso, index) => { const contact = item.contacts[index], committed = item.commits[index].qso,
      expectedSent = [item.sentName, item.sentLocation].filter(Boolean).join(" "), time = utcFields(committed.workedAt ?? committed.originalUTC); assert.equal(committed.sentExchange, expectedSent);
      assert.deepEqual(qso, { frequencyKHz: Math.round(contact.frequency / 1_000), mode: cabrilloMode, date: time.date, minute: time.minute,
        station: item.stationCall, sentName: item.sentName, sentLocation: item.sentLocation || "DX", call: contact.call,
        receivedName: contact.name, receivedLocation: contact.location }); });
  } else {
    const parsed = parseADIF(bytes); assert.equal(parsed.header.ADIF_VER, "3.1.7"); assert.equal(parsed.header.PROGRAMID, "OM0RX-xLog"); assert.equal(parsed.records.length, item.contacts.length);
    parsed.records.forEach((record, index) => { const contact = item.contacts[index], committed = item.commits[index].qso,
      expectedSent = [item.sentName, item.sentLocation].filter(Boolean).join(" "), time = utcFields(committed.workedAt ?? committed.originalUTC); assert.equal(committed.sentExchange, expectedSent);
      assert.equal(record.CALL, contact.call); assert.equal(record.CONTEST_ID, item.id.toUpperCase()); assert.equal(record.MODE, item.mode);
      assert.equal(record.BAND, contact.band); assert.equal(record.FREQ, (contact.frequency / 1_000_000).toFixed(6)); assert.equal(record.QSO_DATE, time.adifDate); assert.equal(record.TIME_ON, time.second);
      assert.equal(record.RST_SENT, undefined); assert.equal(record.RST_RCVD, undefined); assert.equal(record.STATION_CALLSIGN, item.stationCall); assert.equal(record.OPERATOR, item.stationCall);
      assert.equal(record.STX_STRING, expectedSent); assert.equal(record.SRX_STRING, `${contact.name} ${contact.location}`);
      assert.equal(record.STX, undefined); assert.equal(record.SRX, undefined);
      assert.equal(record.MY_STATE, item.stationCall === "K1AAA" ? "CA" : undefined);
      if (contact.call === "KH6AAA") assert.equal(record.STATE, "HI");
      if (contact.call === "HI8A") assert.equal(record.STATE, undefined);
    });
  }
}

const profiles = [{ id: "naqp-cw", label: "NAQP CW", mode: "CW" }, { id: "naqp-ssb", label: "NAQP SSB", mode: "SSB" }];
const cases = profiles.flatMap(profile => ["run", "search-and-pounce"].map(style => {
  const twenty = profile.mode === "CW" ? 14_050_000 : 14_250_000, forty = profile.mode === "CW" ? 7_050_000 : 7_120_000;
  return { ...profile, style, stationCall: "K1AAA", sentName: "AL", sentLocation: "CA", expected: { points: 6, multipliers: 5, score: 30 },
    name: `${profile.label} ${style === "run" ? "Run" : "S&P"} acceptance`, commits: [], contacts: [
      { call: "VE3AAA", name: "SAM", location: "ON", frequency: twenty, band: "20m" },
      { call: "KH6AAA", name: "KAI", location: "HI", frequency: twenty, band: "20m" },
      { call: "HI8A", name: "AKI", location: "HI", frequency: twenty, band: "20m" },
      { call: "K2AAA", name: "BOB", location: "NY", frequency: forty, band: "40m" },
      { call: "VE3BBB", name: "PAT", location: "ON", frequency: forty, band: "40m" },
      { call: "DL1AAA", name: "HANS", location: "DX", frequency: twenty, band: "20m" },
    ] };
}));
const rttyCase = { id: "naqp-rtty", mode: "RTTY", style: "plain-log", stationCall: "K1AAA", sentName: "AL", sentLocation: "CA",
  name: "NAQP RTTY Plain Log acceptance", commits: [], expected: { points: 1, multipliers: 1, score: 1 },
  contacts: [{ call: "VE3AAA", name: "SAM", location: "ON", frequency: 14_080_000, band: "20m" }] };
const dxCase = { id: "naqp-cw", mode: "CW", style: "search-and-pounce", stationCall: "OM0RX", sentName: "OLIVER", sentLocation: "",
  name: "NAQP CW DX entrant acceptance", commits: [], expected: { points: 1, multipliers: 1, score: 1 },
  contacts: [{ call: "K1ABC", name: "PAT", location: "CA", frequency: 14_050_000, band: "20m" }] };
const allCases = [...cases, rttyCase, dxCase];
const missingNAQPExchangeErrors = ["A required exchange field is missing.", "A required exchange field is missing."];
const blankNAQPErrors = [...missingNAQPExchangeErrors, "A valid callsign is required.", "Resolved contest geography is missing or invalid."];
const callOnlyNAQPErrors = contact => [...missingNAQPExchangeErrors, "NAQP name is required.",
  ...(contact.location === "DX" ? [] : ["Received location does not match the resolved North American entity."])];
const sameStrings = (actual, expected) => JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());

async function exportCase(item, format) {
  const locationSelector = '.contest-export-fields input[maxlength="64"][required]', nameSelector = '.contest-export-fields input[maxlength="75"][required]';
  assert.equal(await browser(["get", "count", "button[aria-haspopup='dialog']"]), "1");
  await browser(["click", "button[aria-haspopup='dialog']"]);
  const dialogCount = await browser(["get", "count", "dialog[open]"]);
  if (dialogCount !== "1") throw new Error(`Export dialog did not open for ${item.name}: ${await browser(["errors"])} / ${await text("body")}`);
  await waitText("Prepare a submission file"); await select("Format", format); await fillDialog(locationSelector, "DX"); await fillDialog(nameSelector, "Oliver Acceptance");
  assert.equal(await browser(["get", "value", `dialog[open] ${locationSelector}`]), "DX");
  assert.equal(await browser(["get", "value", `dialog[open] ${nameSelector}`]), "Oliver Acceptance");
  const prepareStart = frames.length; await waitEnabledButton("Prepare export"); await click("Prepare export");
  const preparedFrame = await waitForFrame(prepareStart, frame => frame.request.method === "contest_export_prepare", `export preparation ${item.name}/${format}`);
  assert.equal(preparedFrame.response.ok, true, JSON.stringify(preparedFrame.response.error));
  await waitText(format === "cabrillo" ? "Cabrillo submission preview" : "ADIF compatibility export");
  const assertionCount = exportAssertions.length; pendingExportExpectation = { item, format }; await waitEnabledButton("Save…"); await click("Save…");
  const until = Date.now() + 10_000; while (exportAssertions.length === assertionCount && Date.now() <= until) await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
  assert.equal(exportAssertions.length, assertionCount + 1, `Export save did not complete for ${item.name} ${format}.`); await waitText("Saved"); await waitText("Plain Log");
}

async function openSession(item) {
  await browser(["eval", `(() => { const button=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${JSON.stringify(item.name)})); if(!button) throw new Error('Missing session button'); button.click(); })()`]);
  await waitText("Plain Log");
}

async function setNAQPContact(contact) {
  await fill("Contest callsign", contact.call); await fill("Received Name", contact.name); await fill("Received Location", contact.location);
  await fill("Frequency Hz", String(contact.frequency)); await select("Band", contact.band);
}
async function setNAQPCallOnly(contact, expectedDupe = "clear") {
  await waitEnabledField("Contest callsign");
  const callSelector = ".contest-entry-fields input[aria-label='Contest callsign']";
  const nameSelector = ".contest-entry-fields label:nth-child(2) input", locationSelector = ".contest-entry-fields label:nth-child(3) input";
  const clearedStart = frames.length; await browser(["fill", callSelector, ""]); await browser(["fill", nameSelector, ""]); await browser(["fill", locationSelector, ""]);
  assert.equal(await browser(["get", "value", callSelector]), ""); assert.equal(await browser(["get", "value", nameSelector]), "");
  assert.equal(await browser(["get", "value", locationSelector]), "");
  await fill("Frequency Hz", String(contact.frequency)); await select("Band", contact.band);
  await waitForFrame(clearedStart, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
    frame.response.result.draft.fields.callsign === "" && frame.response.result.draft.fields.receivedExchangeFields?.name === "" &&
    frame.response.result.draft.fields.receivedExchangeFields?.location === "" && frame.response.result.draft.fields.frequencyHz === contact.frequency,
  `cleared NAQP draft for ${contact.call}`);
  const start = frames.length; await fill("Contest callsign", contact.call);
  return waitForFrame(start, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
    frame.response.result.draft.fields.callsign === contact.call &&
    frame.response.result.draft.fields.receivedExchangeFields?.name === "" &&
    frame.response.result.draft.fields.receivedExchangeFields?.location === "" &&
    frame.response.result.draft.dupe.state === expectedDupe &&
    sameStrings(frame.response.result.draft.validation.errors, callOnlyNAQPErrors(contact)), `NAQP call-only ${contact.call}`);
}
async function createNAQPSession(item) {
  await fill("Session name", item.name); await select("Contest", item.id); await fill("Station callsign", item.stationCall);
  await fill("Operator callsign", item.stationCall); await fill("CQ zone", item.stationCall === "K1AAA" ? "5" : "15");
  await fill("DXCC entity", item.stationCall === "K1AAA" ? "United States" : "Slovak Republic"); await fill("Station name", item.sentName);
  if (item.sentLocation) await fill("Station location", item.sentLocation); await click("Create and open"); await waitText(item.name);
}
async function commitNAQP(item, contact, index) {
  const partial = await setNAQPCallOnly(contact); assert.equal(partial.response.result.draft.reservedSerial, null);
  const start = frames.length, outputStart = simulatedOutput.length;
  await waitEnabledButton("Arm simulation"); await click("Arm simulation");
  await pressIn("Contest callsign", "Enter");
  const callOnlyMacros = item.style === "run" ? ["HISCALL", "EXCH"] : ["MYCALL"];
  const callOnlyUntil = Date.now() + 10_000; while (simulatedOutput.slice(outputStart).length < callOnlyMacros.length && Date.now() <= callOnlyUntil)
    await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(simulatedOutput.slice(outputStart).map(entry => entry.macro), callOnlyMacros);
  if (item.style === "run") assert.equal(simulatedOutput.at(-1).text, [item.sentName, item.sentLocation].filter(Boolean).join(" "));
  await fill("Received Name", contact.name); await fill("Received Location", contact.location);
  const complete = await waitForFrame(start, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
    frame.response.result.draft.fields.callsign === contact.call && frame.response.result.draft.fields.receivedExchangeFields?.name === contact.name &&
    frame.response.result.draft.fields.receivedExchangeFields?.location === contact.location && frame.response.result.draft.dupe.state !== "unchecked",
  `complete NAQP exchange ${contact.call}`);
  assert.deepEqual(complete.response.result.draft.validation.errors, []);
  await waitEnabledButton("Arm simulation"); await click("Arm simulation");
  await pressIn("Received Location", "Enter");
  const committed = await waitForFrame(start, frame => frame.request.method === "contest_qso_commit" && frame.response.ok, `NAQP commit ${item.name}/${index}`);
  item.commits.push(committed.response.result); assert.equal(committed.response.result.qso.sentExchange, [item.sentName, item.sentLocation].filter(Boolean).join(" "));
  const expectedMacros = item.style === "run" ? ["HISCALL", "EXCH", "QRZ"] : ["MYCALL", "EXCH"];
  assert.deepEqual(simulatedOutput.slice(outputStart).map(entry => entry.macro), expectedMacros, `Unexpected simulated output sequence for ${item.name}/${index}.`);
  assert.equal(frames.slice(start).some(frame => frame.request.method === "contest_serial_reserve"), false); await waitText(`${index + 1} contacts`);
  if (item.style === "run") {
    assert.equal(sameStrings(committed.response.result.draft.validation.errors, blankNAQPErrors), true);
    const cqStart = simulatedOutput.length; await waitEnabledButton("Disarm"); await pressIn("Contest callsign", "Enter");
    const cqUntil = Date.now() + 10_000; while (simulatedOutput.length === cqStart && Date.now() <= cqUntil) await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(simulatedOutput.slice(cqStart).map(entry => entry.macro), ["CQ"]); await pressIn("Contest callsign", "Escape");
  }
}
async function createNAQPCase(item) {
  await createNAQPSession(item); await select("Operating style", item.style);
  if (item.style === "run") {
    const blankStart = frames.length; await fill("Frequency Hz", String(item.contacts[0].frequency)); await select("Band", item.contacts[0].band);
    const blank = await waitForFrame(blankStart, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
      frame.response.result.draft.fields.callsign === "" && frame.response.result.draft.fields.frequencyHz === item.contacts[0].frequency &&
      sameStrings(frame.response.result.draft.validation.errors, blankNAQPErrors), `initial blank NAQP ${item.mode} Run draft`);
    assert.equal(blank.response.result.draft.dupe.state, "unchecked");
    const cqStart = simulatedOutput.length; await waitEnabledButton("Arm simulation"); await click("Arm simulation");
    await pressIn("Contest callsign", item.mode === "CW" ? "Enter" : "F1");
    const cqUntil = Date.now() + 10_000; while (simulatedOutput.length === cqStart && Date.now() <= cqUntil) await new Promise(resolve => setTimeout(resolve, 25));
    assert.deepEqual(simulatedOutput.slice(cqStart).map(entry => entry.macro), ["CQ"]); await pressIn("Contest callsign", "Escape");
  }
  for (const [index, contact] of item.contacts.entries()) {
    await commitNAQP(item, contact, index);
  }
  const partialDuplicateStart = frames.length, partialDuplicateOutput = simulatedOutput.length;
  const partialDuplicate = await setNAQPCallOnly(item.contacts[0], "duplicate");
  assert.equal(partialDuplicate.response.result.draft.dupe.state, "duplicate");
  assert.equal(sameStrings(partialDuplicate.response.result.draft.validation.errors, callOnlyNAQPErrors(item.contacts[0])), true);
  await waitEnabledButton("Arm simulation"); await click("Arm simulation"); await pressIn("Contest callsign", "Enter");
  const partialDuplicateMacros = ["QSOB4"];
  const partialDuplicateUntil = Date.now() + 10_000;
  while (simulatedOutput.slice(partialDuplicateOutput).length < partialDuplicateMacros.length && Date.now() <= partialDuplicateUntil)
    await new Promise(resolve => setTimeout(resolve, 25));
  assert.deepEqual(simulatedOutput.slice(partialDuplicateOutput).map(entry => entry.macro), partialDuplicateMacros);
  assert.equal(frames.slice(partialDuplicateStart).some(frame => frame.request.method === "contest_qso_commit"), false);
  observations.push({ case: item.name, phase: "call-only-duplicate-authoritative", call: item.contacts[0].call,
    dupe: partialDuplicate.response.result.draft.dupe, output: partialDuplicateMacros });
  await pressIn("Contest callsign", "Escape");
  if (item.id === "naqp-cw" && item.style === "run") {
    for (const call of ["DL1ABC", "K1ABC/MM"]) {
      const invalidPartialStart = frames.length;
      await fill("Contest callsign", call); await fill("Received Name", ""); await fill("Received Location", "CA");
      const invalidPartial = await waitForFrame(invalidPartialStart, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
        frame.response.result.draft.fields.callsign === call && frame.response.result.draft.fields.receivedExchangeFields?.name === "" &&
        frame.response.result.draft.fields.receivedExchangeFields?.location === "CA" && frame.response.result.draft.dupe.state === "unchecked",
      `invalid partial NAQP location ${call}`);
      const blockedPartial = { output: simulatedOutput.length,
        commits: frames.filter(frame => frame.request.method === "contest_qso_commit").length };
      if (await browser(["eval", "[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Arm simulation')"]))
        await click("Arm simulation");
      await pressIn("Contest callsign", "Enter"); await new Promise(resolve => setTimeout(resolve, 200));
      assert.deepEqual({ output: simulatedOutput.length,
        commits: frames.filter(frame => frame.request.method === "contest_qso_commit").length }, blockedPartial);
      observations.push({ case: item.name, phase: "invalid-partial-location-blocked", call,
        dupe: invalidPartial.response.result.draft.dupe, errors: invalidPartial.response.result.draft.validation.errors });
    }
    await pressIn("Contest callsign", "Escape");
  }
  const before = { commits: frames.filter(frame => frame.request.method === "contest_qso_commit").length, output: simulatedOutput.length };
  await setNAQPContact(item.contacts[0]); await waitText("Duplicate"); await waitEnabledButton("Arm simulation"); await click("Arm simulation");
  await pressIn(item.style === "run" ? "Contest callsign" : "Received Location", "Enter"); await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(frames.filter(frame => frame.request.method === "contest_qso_commit").length, before.commits);
  if (item.style === "run") { assert.equal(simulatedOutput.length, before.output + 1); assert.equal(simulatedOutput.at(-1).macro, "QSOB4"); } else assert.equal(simulatedOutput.length, before.output);
  await waitMatchingText("[aria-label='Score and multipliers']", "Claimed score\\s*30.*QSOs\\s*6.*Points\\s*6.*Multipliers\\s*5");
  await browser(["screenshot", join(evidenceRoot, `${item.id}-${item.style}.png`)]); await exportCase(item, "cabrillo"); await exportCase(item, "adif");
  if (item.id === "naqp-cw" && item.style === "search-and-pounce") {
    const contact = item.contacts[0]; await click("Import local file"); await waitText("acceptance-valid.scp");
    await fill("Received Name", contact.name); await fill("Received Location", contact.location); await fill("Contest callsign", "VE3");
    await browser(["eval", "new Promise((resolve,reject)=>{ const until=Date.now()+10000; const poll=()=>{ const button=[...document.querySelectorAll('.contest-scp-matches button')].find(x=>x.textContent.includes('VE3AAA')); if(button) return resolve(true); if(Date.now()>until) return reject(new Error('SCP candidate did not appear')); setTimeout(poll,50); }; poll(); })"]); const applyStart = frames.length;
    await browser(["eval", "(() => { const root=document.querySelector('.contest-scp-matches'),button=[...root.querySelectorAll('button')].find(x=>x.textContent.includes('VE3AAA')); if(!button) throw new Error('Missing SCP candidate'); button.click(); })()"]);
    const selected = await waitForFrame(applyStart, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
      frame.response.result.draft.fields.callsign === "VE3AAA", "NAQP SCP selection");
    assert.deepEqual(selected.response.result.draft.fields.receivedExchangeFields, { name: contact.name, location: contact.location });
  }
  const invalidStart = frames.length; await fill("Contest callsign", item.contacts[0].call); await fill("Received Name", item.contacts[0].name);
  await fill("Received Location", "CA");
  const invalid = await waitForFrame(invalidStart, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
    frame.response.result.draft.fields.callsign === item.contacts[0].call && frame.response.result.draft.fields.receivedExchangeFields?.location === "CA" &&
    frame.response.result.draft.validation.errors.length > 0, "authoritative invalid NAQP location");
  const blocked = { output: simulatedOutput.length, commits: frames.filter(frame => frame.request.method === "contest_qso_commit").length };
  await waitEnabledButton("Arm simulation"); await click("Arm simulation"); await pressIn("Received Location", "Enter"); await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual({ output: simulatedOutput.length, commits: frames.filter(frame => frame.request.method === "contest_qso_commit").length }, blocked);
  observations.push({ case: item.name, phase: "invalid-received-location-blocked", errors: invalid.response.result.draft.validation.errors });
  await pressIn("Received Location", "Escape");
  await openManager();
}
async function createRTTYCase() {
  await createNAQPSession(rttyCase); await waitText("plain logging only");
  assert.equal(await browser(["eval", "![...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Arm simulation')"]), "true");
  await setNAQPContact(rttyCase.contacts[0]); await waitEnabledButton("Log QSO"); const start = frames.length; await click("Log QSO");
  const committed = await waitForFrame(start, frame => frame.request.method === "contest_qso_commit" && frame.response.ok, "NAQP RTTY plain-log commit");
  rttyCase.commits.push(committed.response.result); assert.equal(frames.slice(start).some(frame => frame.request.method === "contest_serial_reserve"), false);
  await waitText("1 contacts"); await exportCase(rttyCase, "cabrillo"); await exportCase(rttyCase, "adif"); await openManager();
}
async function createDXCase() {
  await createNAQPSession(dxCase); await select("Operating style", dxCase.style); await commitNAQP(dxCase, dxCase.contacts[0], 0);
  assert.equal(simulatedOutput.at(-1).text, "OLIVER"); assert.notEqual(simulatedOutput.at(-1).text, "OLIVER DX");
  await exportCase(dxCase, "cabrillo"); await exportCase(dxCase, "adif");
  const invalidStart = frames.length; await setNAQPContact({ call: "DL1AAA", name: "HANS", location: "DX", frequency: 14_050_000, band: "20m" });
  const invalid = await waitForFrame(invalidStart, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
    frame.response.result.draft.fields.callsign === "DL1AAA" && frame.response.result.draft.validation.errors.length > 0, "DX-to-DX rejection");
  const before = frames.filter(frame => frame.request.method === "contest_qso_commit").length; await waitEnabledButton("Arm simulation"); await click("Arm simulation");
  await pressIn("Received Location", "Enter"); await new Promise(resolve => setTimeout(resolve, 200)); assert.equal(frames.filter(frame => frame.request.method === "contest_qso_commit").length, before);
  observations.push({ phase: "dx-to-dx-rejected", errors: invalid.response.result.draft.validation.errors });
  await pressIn("Received Location", "Escape");
}

let primaryFailure = null;
try {
  await browser(["open", url]); await waitText("Contest Workspace");
  for (const item of cases) await createNAQPCase(item);
  await createRTTYCase(); await createDXCase();
  const repair = cases.find(item => item.id === "naqp-cw" && item.style === "run");
  await successful("__acceptance_restart"); await browser(["reload"]); await waitText(repair.name); await openSession(repair);
  await expectText("[aria-label='Contest log']", /6 contacts/); await click("Edit VE3AAA"); await waitText("Update the contact");
  const correctedNameSelector = ".contest-qso-editor .contest-qso-fields label:nth-child(2) input";
  await browser(["fill", correctedNameSelector, "SAMUEL"]); assert.equal(await browser(["get", "value", correctedNameSelector]), "SAMUEL");
  await fill("Correction note", "Synthetic NAQP correction"); const correctionStart = frames.length; await click("Save correction"); await waitText("Saved VE3AAA");
  const correction = await waitForFrame(correctionStart, frame => frame.request.method === "contest_qso_correct" && frame.response.ok, "NAQP correction receipt");
  assert.equal(correction.response.result.currentTarget.receivedExchangeFields.name, "SAMUEL");
  await waitMatchingText("[aria-label='Score and multipliers']", "Claimed score\\s*30.*QSOs\\s*6.*Points\\s*6.*Multipliers\\s*5");
  await click("Edit HI8A"); await waitText("Update the contact"); await click("Delete contact"); await fill("Deletion note", "Synthetic NAQP deletion");
  await click("Confirm deletion"); await waitText("Deleted HI8A");
  await waitMatchingText("[aria-label='Score and multipliers']", "Claimed score\\s*20.*QSOs\\s*5.*Points\\s*5.*Multipliers\\s*4");
  const repaired = { ...repair, name: `${repair.name} corrected`, expected: { points: 5, multipliers: 4, score: 20 },
    contacts: repair.contacts.map(contact => contact.call === "VE3AAA" ? { ...contact, name: "SAMUEL" } : contact).filter(contact => contact.call !== "HI8A"),
    commits: repair.commits.map(result => result.qso.callsign === "VE3AAA" ? { ...result, qso: correction.response.result.currentTarget } : result).filter(result => result.qso.callsign !== "HI8A") };
  await exportCase(repaired, "cabrillo"); await exportCase(repaired, "adif");
  const deletedStart = frames.length;
  await setNAQPContact({ call: "HI8A", name: "AKI", location: "HI", frequency: 14_050_000, band: "20m" });
  const deletedDraft = await waitForFrame(deletedStart, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
    frame.response.result.draft.fields.callsign === "HI8A" && frame.response.result.draft.dupe.state === "clear", "deleted NAQP contact dupe clearance");
  assert.equal(deletedDraft.response.result.draft.reservedSerial, null);
  const retainedStart = frames.length;
  await setNAQPContact({ call: "VE3AAA", name: "SAMUEL", location: "ON", frequency: 14_050_000, band: "20m" });
  const retainedDraft = await waitForFrame(retainedStart, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
    frame.response.result.draft.fields.callsign === "VE3AAA" && frame.response.result.draft.dupe.state === "duplicate", "retained NAQP contact duplicate");
  assert.equal(retainedDraft.response.result.draft.reservedSerial, null);
  await browser(["screenshot", join(evidenceRoot, "restart-naqp-correction-deletion.png")]); await openManager();
  const status = await successful("workspace_status"); assert.deepEqual({ qso: status.qso_count, pending: status.pending_sync_count, outbox: status.outbox_count }, { qso: 0, pending: 0, outbox: 0 });
  assert.equal(simulatedOutput.some(item => item.macro === "HISCALL"), true); assert.equal(simulatedOutput.some(item => item.macro === "EXCH"), true);
  assert.equal(frames.some(item => item.request.method === "contest_serial_reserve"), false); assert.equal(exportAssertions.length, 14);
  await browser(["close"], false);
} catch (error) { primaryFailure = error; }
finally { try { await browser(["close"], false); } catch {} try { await successful("__acceptance_shutdown"); } catch {} try { await vite.close(); } catch {} await new Promise(resolveClose => server.close(resolveClose)); }

const inventory = rootPath => { const rows = []; const visit = (path, relative) => { const value = lstatSync(path); assert.equal(value.isSymbolicLink(), false); if (value.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name), relative ? `${relative}/${name}` : name); else rows.push({ path: relative, size: value.size, sha256: hashFile(path) }); }; visit(rootPath, ""); return rows; };
const protectedAfter = Object.fromEntries(protectedPaths.map(path => [path, metadata(path)]));
if (primaryFailure === null) { try { assert.deepEqual(protectedAfter, protectedBefore, "Protected production database metadata changed."); } catch (error) { primaryFailure = error; } }
const evidence = { schemaVersion: 3, ok: primaryFailure === null, boundary: "Headless Vite UI driving a SwiftPM test host around the real isolated LiveWorker; CW/SSB output is visible simulation only, RTTY is Plain Log only, and this is not a packaged worker/app, native window, RF, audio, PTT, hardware, or sponsor-submission acceptance.", source: { expectedHead, actualHead, dirty: gitStatus.length > 0, status: gitStatus, trackedDiffBytes: trackedDiff.length, trackedDiffSha256: sha256(trackedDiff), untrackedSourceDigests }, testHost: { path: testHostBinary, sha256: testHostSha256 }, testRunner: { path: testRunnerBinary, sha256: testRunnerSha256 }, processRecoveryProbe, runID, url, cases: allCases, actions, observations, simulatedOutput, lifecycle, frameCount: frames.length, frames, exportAssertions, exports: inventory(exportRoot), syntheticInventory: inventory(isolatedHome), protectedDatabaseMetadataUnchanged: JSON.stringify(protectedAfter) === JSON.stringify(protectedBefore), failure: primaryFailure ? String(primaryFailure.stack || primaryFailure) : null };
writeFileSync(join(evidenceRoot, "acceptance.json"), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdin.destroy();
if (primaryFailure) throw primaryFailure;
assert.ok(frames.length > 0);
process.stderr.write(`${JSON.stringify({ ok: true, sourceHead: expectedHead, testHostSha256, frames: frames.length, exports: evidence.exports.length, evidence: join(evidenceRoot, "acceptance.json") })}\n`);
