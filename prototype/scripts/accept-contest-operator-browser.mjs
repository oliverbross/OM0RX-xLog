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
    env: { ...process.env, AGENT_BROWSER_SESSION: session }, timeoutMs: 20_000, terminateGraceMs: 1_000 });
  return result.stdout.trim();
}
const waitText = text => browser(["wait", "--text", text]);
const fill = (label, value) => browser(["find", "label", label, "fill", value]);
const select = (label, value) => browser(["eval", `(() => { const direct=[...document.querySelectorAll('select')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)}); const owner=[...document.querySelectorAll('label')].find(x=>x.firstChild?.textContent?.trim()===${JSON.stringify(label)}); const select=direct ?? owner?.querySelector('select'); if(!select) throw new Error('Missing select'); select.value=${JSON.stringify(value)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`]);
const click = name => browser(["find", "role", "button", "click", "--name", name]);
const waitEnabledButton = name => browser(["eval", `new Promise((resolve,reject)=>{ const until=Date.now()+10000; const poll=()=>{ const button=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(name)}); if(button && !button.disabled) return resolve(true); if(Date.now()>until) return reject(new Error('Button did not become enabled: '+${JSON.stringify(name)})); setTimeout(poll,50); }; poll(); })`]);
const pressIn = async (label, key) => { await browser(["eval", `(() => { const direct=[...document.querySelectorAll('input,select,textarea')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(label)}); const owner=[...document.querySelectorAll('label')].find(x=>x.textContent.startsWith(${JSON.stringify(label)})); const field=direct ?? owner?.querySelector('input,select,textarea'); if(!field) throw new Error('Missing field'); field.focus(); })()`]); await browser(["press", key]); };
const text = selector => browser(["get", "text", selector]);
const expectText = async (selector, expected) => assert.match(await text(selector), expected instanceof RegExp ? expected : new RegExp(expected));
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
const expectedInitialSent = (item, index) => item.id.includes("wpx") ? String(index + 1).padStart(3, "0") : "15";
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
    const parsed = parseCabrillo(bytes); assert.equal(parsed.headers.CONTEST, item.id.toUpperCase()); assert.equal(parsed.headers.CALLSIGN, "OM0RX");
    assert.equal(parsed.headers["CATEGORY-MODE"], expectedMode); assert.equal(Number(parsed.headers["CLAIMED-SCORE"]), item.expected.score); assert.equal(parsed.headers.NAME, "Oliver Acceptance");
    assert.equal(parsed.qsos.length, item.contacts.length);
    parsed.qsos.forEach((qso, index) => { const contact = item.contacts[index], committed = item.commits[index].qso,
      expectedSent = expectedInitialSent(item, index), time = utcFields(committed.workedAt); assert.equal(committed.sentExchange, expectedSent);
      assert.deepEqual(qso, { frequencyKHz: Math.round(contact.frequency / 1_000), mode: cabrilloMode, date: time.date, minute: time.minute,
        station: "OM0RX", sentReport: item.reports, sentExchange: expectedSent, call: contact.call,
        receivedReport: item.reports, receivedExchange: contact.rx }); });
  } else {
    const parsed = parseADIF(bytes); assert.equal(parsed.header.ADIF_VER, "3.1.7"); assert.equal(parsed.header.PROGRAMID, "OM0RX-xLog"); assert.equal(parsed.records.length, item.contacts.length);
    parsed.records.forEach((record, index) => { const contact = item.contacts[index], committed = item.commits[index].qso,
      expectedSent = expectedInitialSent(item, index), time = utcFields(committed.workedAt); assert.equal(committed.sentExchange, expectedSent);
      assert.equal(record.CALL, contact.call); assert.equal(record.CONTEST_ID, item.id.toUpperCase()); assert.equal(record.MODE, expectedMode);
      assert.equal(record.BAND, contact.band); assert.equal(record.FREQ, (contact.frequency / 1_000_000).toFixed(6)); assert.equal(record.QSO_DATE, time.adifDate); assert.equal(record.TIME_ON, time.second);
      assert.equal(record.RST_SENT, item.reports); assert.equal(record.RST_RCVD, item.reports); assert.equal(record.STATION_CALLSIGN, "OM0RX"); assert.equal(record.OPERATOR, "OM0RX");
      assert.equal(record.STX_STRING, expectedSent); assert.equal(record.SRX_STRING, contact.rx);
      if (item.id.includes("wpx")) { assert.equal(record.STX, String(Number(expectedSent))); assert.equal(record.SRX, String(Number(contact.rx))); }
      else { assert.equal(record.STX, undefined); assert.equal(record.SRX, undefined); }
    });
  }
}

const profiles = [
  { id: "cq-ww-cw", label: "WW CW", mode: "CW", reports: "599", exchanges: ["05", "14", "05"], expected: { points: 7, multipliers: 6, score: 42 } },
  { id: "cq-wpx-cw", label: "WPX CW", mode: "CW", reports: "599", exchanges: ["123", "124", "125"], expected: { points: 11, multipliers: 2, score: 22 } },
  { id: "cq-ww-ssb", label: "WW SSB", mode: "SSB", reports: "59", exchanges: ["05", "14", "05"], expected: { points: 7, multipliers: 6, score: 42 } },
  { id: "cq-wpx-ssb", label: "WPX SSB", mode: "SSB", reports: "59", exchanges: ["123", "124", "125"], expected: { points: 11, multipliers: 2, score: 22 } },
];
const cases = profiles.flatMap(profile => ["run", "search-and-pounce"].map(style => {
  const frequencies = profile.mode === "CW" ? [14_025_000, 7_025_000, 7_025_000] : [14_250_000, 7_120_000, 7_120_000];
  return { ...profile, style, name: `${profile.label} ${style === "run" ? "Run" : "S&P"} acceptance`, commits: [],
    contacts: [{ call: "K1ABC", rx: profile.exchanges[0], frequency: frequencies[0], band: "20m" },
      { call: "DL1ABC", rx: profile.exchanges[1], frequency: frequencies[1], band: "40m" },
      { call: "K1ABC", rx: profile.exchanges[2], frequency: frequencies[2], band: "40m" }] };
}));

async function exportCase(item, format) {
  await waitEnabledButton("Export…"); await click("Export…");
  observations.push({ phase: "export-open", case: item.id, style: item.style, format,
    state: await browser(["eval", `new Promise(resolve=>setTimeout(()=>{ const button=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Export…'); const dialog=document.querySelector('dialog[aria-label="Export contest log"]'); resolve(JSON.stringify({buttonDisabled:button?.disabled??null,dialogPresent:!!dialog,dialogOpen:dialog?.open??false,heading:dialog?.querySelector('h2')?.textContent??null})); },250))`]) });
  await waitText("Prepare a submission file"); await select("Format", format); await fill("Location", "DX"); await fill("Name", "Oliver Acceptance");
  await click("Prepare export"); await waitText(format === "cabrillo" ? "Cabrillo submission preview" : "ADIF compatibility export");
  const assertionCount = exportAssertions.length; pendingExportExpectation = { item, format }; await click("Save…");
  const until = Date.now() + 10_000; while (exportAssertions.length === assertionCount && Date.now() <= until) await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
  assert.equal(exportAssertions.length, assertionCount + 1, `Export save did not complete for ${item.name} ${format}.`); await waitText("Saved"); await waitText("Plain Log");
}

async function createCase(item) {
  await fill("Session name", item.name); await select("Contest", item.id); await fill("Station callsign", "OM0RX"); await fill("Operator callsign", "OM0RX"); await fill("CQ zone", "15"); await fill("DXCC entity", "Slovak Republic"); await click("Create and open"); await waitText("Plain Log"); await waitText(item.name);
  await select("Operating style", item.style);
  if (item.style === "run") { await fill("Frequency Hz", String(item.contacts[0].frequency)); await select("Band", "20m"); await waitEnabledButton("Arm simulation"); await click("Arm simulation"); await waitText("Armed for simulated output"); await pressIn("Contest callsign", "Enter"); await waitText("CQ"); }
  for (const [index, contact] of item.contacts.entries()) {
    await fill("Contest callsign", contact.call); await fill("Received report", item.reports); await fill("Frequency Hz", String(contact.frequency)); await select("Band", contact.band);
    if (index === 0) {
      const before = frames.filter(frame => frame.request.method === "contest_qso_commit" && frame.response.ok).length;
      await waitEnabledButton("Arm simulation"); await click("Arm simulation"); await waitText("Armed for simulated output"); await pressIn("Received exchange", "Enter"); await waitText("AGN");
      assert.equal(frames.filter(frame => frame.request.method === "contest_qso_commit" && frame.response.ok).length, before);
      const invalid = item.id.includes("wpx") ? "0" : "99", after = frames.length;
      await fill("Received exchange", invalid);
      const invalidFrame = await waitForFrame(after, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
        frame.response.result.draft.fields.receivedExchange === invalid && frame.response.result.draft.validation.errors.length > 0,
      `authoritative invalid ${item.id} draft`);
      await waitEnabledButton("Arm simulation");
      const blocked = { simulated: simulatedOutput.length,
        reserves: frames.filter(frame => frame.request.method === "contest_serial_reserve").length,
        commits: frames.filter(frame => frame.request.method === "contest_qso_commit").length };
      await click("Arm simulation"); await waitText("Armed for simulated output"); await pressIn("Received exchange", "Enter");
      await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
      assert.deepEqual({ simulated: simulatedOutput.length,
        reserves: frames.filter(frame => frame.request.method === "contest_serial_reserve").length,
        commits: frames.filter(frame => frame.request.method === "contest_qso_commit").length }, blocked);
      observations.push({ case: item.id, contact: index, phase: "authoritative-invalid-received-exchange-blocked",
        validation: invalidFrame.response.result.draft.validation.errors,
        operator: await text("[aria-label='Run and S&P simulation']") });
    }
    await fill("Received exchange", contact.rx); await waitEnabledButton("Arm simulation"); await click("Arm simulation"); await waitText("Armed for simulated output"); await new Promise(resolveDelay => setTimeout(resolveDelay, 300));
    observations.push({ case: item.id, contact: index, phase: "before-enter", operator: await text("[aria-label='Run and S&P simulation']") });
    const commitStart = frames.length;
    if (item.style === "run") {
      const outputStart = simulatedOutput.length; await pressIn("Contest callsign", "Enter");
      const until = Date.now() + 10_000; while (!simulatedOutput.slice(outputStart).some(entry => entry.macro === "EXCH") && Date.now() <= until) await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
      assert.equal(simulatedOutput.slice(outputStart).some(entry => entry.macro === "EXCH"), true, `Run exchange did not settle for ${item.name} ${index}.`);
    }
    await pressIn("Received exchange", "Enter");
    const committed = await waitForFrame(commitStart, frame => frame.request.method === "contest_qso_commit" && frame.response.ok, `commit ${item.name} ${index}`);
    item.commits.push(committed.response.result); await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
    observations.push({ case: item.id, contact: index, phase: "after-enter", operator: await text("[aria-label='Run and S&P simulation']") });
    await waitText(`${index + 1} contacts`);
  }
  const duplicate = item.contacts[0], beforeDuplicate = { commits: frames.filter(frame => frame.request.method === "contest_qso_commit").length, output: simulatedOutput.length };
  await fill("Contest callsign", duplicate.call); await fill("Received report", item.reports); await fill("Received exchange", duplicate.rx);
  await fill("Frequency Hz", String(duplicate.frequency)); await select("Band", duplicate.band); await new Promise(resolveDelay => setTimeout(resolveDelay, 300));
  if (item.id.includes("wpx")) {
    await waitEnabledButton("Reserve serial"); await click("Reserve serial");
  }
  await waitText("Duplicate");
  await waitEnabledButton("Arm simulation"); await click("Arm simulation"); await waitText("Armed for simulated output");
  if (item.style === "run") await pressIn("Contest callsign", "Enter"); await pressIn("Received exchange", "Enter"); await new Promise(resolveDelay => setTimeout(resolveDelay, 250));
  assert.equal(frames.filter(frame => frame.request.method === "contest_qso_commit").length, beforeDuplicate.commits);
  assert.equal(simulatedOutput.length, beforeDuplicate.output + (item.style === "run" ? 1 : 0));
  if (item.style === "run") assert.equal(simulatedOutput.at(-1)?.macro, "QSOB4");
  observations.push({ case: item.id, style: item.style, phase: "duplicate-blocked", operator: await text("[aria-label='Run and S&P simulation']") });
  await expectText("[aria-label='Score and multipliers']", new RegExp(`Claimed score\\s*${item.expected.score}.*QSOs\\s*3.*Points\\s*${item.expected.points}.*Multipliers\\s*${item.expected.multipliers}`, "s"));
  await browser(["screenshot", join(evidenceRoot, `${item.id}-${item.style}.png`)]);
  await exportCase(item, "cabrillo"); await exportCase(item, "adif");
  await click("Contest Manager"); await waitText("Contest sessions");
}

async function openSession(item) {
  await browser(["eval", `(() => { const button=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${JSON.stringify(item.name)})); if(!button) throw new Error('Missing session button'); button.click(); })()`]);
  await waitText("Plain Log");
}

async function expectDraftDupe(item, contact, state, reservedSerial) {
  const after = frames.length;
  await fill("Contest callsign", contact.call); await fill("Received report", item.reports); await fill("Received exchange", contact.rx);
  await fill("Frequency Hz", String(contact.frequency)); await select("Band", contact.band);
  const applied = await waitForFrame(after, frame => frame.request.method === "contest_draft_apply" && frame.response.ok &&
    frame.response.result.draft.fields.callsign === contact.call && frame.response.result.draft.fields.receivedExchange === contact.rx &&
    frame.response.result.draft.fields.frequencyHz === contact.frequency && frame.response.result.draft.fields.band === contact.band &&
    frame.response.result.draft.dupe.state === state, `${item.name} ${contact.call}/${contact.band} ${state} reclassification`);
  assert.equal(applied.response.result.draft.reservedSerial, reservedSerial);
  await expectText(".contest-validation", state === "duplicate" ? /Duplicate/ : /Dupe check/);
  observations.push({ case: item.id, style: item.style, phase: "post-delete-dupe-reclassification", callsign: contact.call,
    band: contact.band, state, reservedSerial });
}

let primaryFailure = null;
try {
  await browser(["open", url]); await waitText("Contest Workspace");
  for (const item of cases) await createCase(item);
  await successful("__acceptance_restart"); await waitText(cases[0].name);
  const wwRepair = cases.find(item => item.id === "cq-ww-cw" && item.style === "run"); await openSession(wwRepair);
  await expectText("[aria-label='Contest log']", /3 contacts/); await click("Edit K1ABC"); await waitText("Update the contact");
  await browser(["eval", `(() => { const root=document.querySelector('.contest-qso-editor'); const label=[...root.querySelectorAll('label')].find(x=>x.textContent.startsWith('Received exchange')); const input=label.querySelector('input'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'04'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`]);
  await fill("Correction note", "Synthetic WW acceptance correction"); const wwCorrectionStart = frames.length; await click("Save correction"); await waitText("Saved K1ABC");
  const wwCorrection = await waitForFrame(wwCorrectionStart, frame => frame.request.method === "contest_qso_correct" && frame.response.ok, "WW correction receipt");
  assert.equal(wwCorrection.response.result.currentTarget.receivedExchange, "04"); assert.equal(wwCorrection.response.result.currentTarget.normalizedReceivedExchange, "04");
  await expectText("[aria-label='Score and multipliers']", /Claimed score\s*42.*QSOs\s*3.*Points\s*7.*Multipliers\s*6/s);
  await click("Edit DL1ABC"); await waitText("Update the contact"); await click("Delete contact"); await fill("Deletion note", "Synthetic acceptance deletion"); await click("Confirm deletion"); await waitText("Deleted DL1ABC"); await expectText("[aria-label='Contest log']", /2 contacts/);
  await expectText("[aria-label='Score and multipliers']", /Claimed score\s*24.*QSOs\s*2.*Points\s*6.*Multipliers\s*4/s);
  await expectDraftDupe(wwRepair, { call: "DL1ABC", rx: "14", frequency: 7_025_000, band: "40m" }, "clear", null);
  await expectDraftDupe(wwRepair, { call: "K1ABC", rx: "05", frequency: 7_025_000, band: "40m" }, "duplicate", null);
  await browser(["screenshot", join(evidenceRoot, "restart-ww-correction-deletion.png")]); await click("Contest Manager"); await waitText("Contest sessions");
  const wpxRepair = cases.find(item => item.id === "cq-wpx-cw" && item.style === "run"); await openSession(wpxRepair);
  await waitText("Serial 4"); await click("Edit K1ABC"); await waitText("Update the contact");
  await browser(["eval", `(() => { const root=document.querySelector('.contest-qso-editor'); const label=[...root.querySelectorAll('label')].find(x=>x.textContent.startsWith('Received exchange')); const input=label.querySelector('input'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'126'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`]);
  await fill("Correction note", "Synthetic WPX acceptance correction"); const wpxCorrectionStart = frames.length; await click("Save correction"); await waitText("Saved K1ABC");
  const wpxCorrection = await waitForFrame(wpxCorrectionStart, frame => frame.request.method === "contest_qso_correct" && frame.response.ok, "WPX correction receipt");
  assert.equal(wpxCorrection.response.result.currentTarget.receivedExchange, "126"); assert.equal(wpxCorrection.response.result.currentTarget.normalizedReceivedExchange, "126");
  await expectText("[aria-label='Score and multipliers']", /Claimed score\s*22.*QSOs\s*3.*Points\s*11.*Multipliers\s*2/s);
  await click("Edit DL1ABC"); await waitText("Update the contact"); await click("Delete contact"); await fill("Deletion note", "Synthetic WPX acceptance deletion"); await click("Confirm deletion"); await waitText("Deleted DL1ABC");
  await expectText("[aria-label='Score and multipliers']", /Claimed score\s*9.*QSOs\s*2.*Points\s*9.*Multipliers\s*1/s);
  await expectDraftDupe(wpxRepair, { call: "DL1ABC", rx: "124", frequency: 7_025_000, band: "40m" }, "clear", 4);
  await expectDraftDupe(wpxRepair, { call: "K1ABC", rx: "125", frequency: 7_025_000, band: "40m" }, "duplicate", 4);
  await fill("Contest callsign", "N0XYZ"); await fill("Received report", "599"); await fill("Received exchange", "127"); await fill("Frequency Hz", "21025000"); await select("Band", "15m");
  await waitEnabledButton("Arm simulation"); await click("Arm simulation"); const serialCommitStart = frames.length;
  const serialOutputStart = simulatedOutput.length; await pressIn("Contest callsign", "Enter");
  const serialUntil = Date.now() + 10_000; while (!simulatedOutput.slice(serialOutputStart).some(entry => entry.macro === "EXCH") && Date.now() <= serialUntil) await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
  assert.equal(simulatedOutput.slice(serialOutputStart).some(entry => entry.macro === "EXCH"), true); await pressIn("Received exchange", "Enter");
  const serialCommit = await waitForFrame(serialCommitStart, frame => frame.request.method === "contest_qso_commit" && frame.response.ok, "post-delete WPX commit");
  assert.equal(serialCommit.response.result.qso.sentExchange, "004"); await waitText("3 contacts");
  await expectText("[aria-label='Score and multipliers']", /Claimed score\s*24.*QSOs\s*3.*Points\s*12.*Multipliers\s*2/s);
  await browser(["screenshot", join(evidenceRoot, "restart-wpx-correction-deletion-serial.png")]); await browser(["close"], false);
  const status = await successful("workspace_status"); assert.deepEqual({ qso: status.qso_count, pending: status.pending_sync_count, outbox: status.outbox_count }, { qso: 0, pending: 0, outbox: 0 });
  assert.equal(simulatedOutput.some(item => item.macro === "CQ"), true); assert.equal(simulatedOutput.some(item => item.macro === "EXCH"), true);
  const commits = frames.filter(item => item.request.method === "contest_qso_commit" && item.response.ok).map(item => item.response.result);
  assert.equal(commits.length, 25);
  for (const item of cases.filter(item => item.id.includes("wpx"))) assert.deepEqual(item.commits.map(result => result.qso.sentExchange), ["001", "002", "003"]);
  assert.equal(exportAssertions.length, 16);
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
