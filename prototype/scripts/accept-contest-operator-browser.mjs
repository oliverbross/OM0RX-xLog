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
const frames = [], lifecycle = [], actions = [], simulatedOutput = [], observations = [];
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
  const chunks = []; let offset = 0;
  while (offset < prepared.byteLength) {
    const frame = await successful("contest_export_read", { exportID: prepared.artifactID, sessionID: prepared.sessionID, workspaceGeneration: prepared.workspaceGeneration, offset, length: Math.min(65_536, prepared.byteLength - offset) });
    assert.equal(frame.offset, offset); const bytes = Buffer.from(frame.dataBase64, "base64"); chunks.push(bytes); offset += bytes.length; assert.equal(frame.eof, offset === prepared.byteLength);
  }
  const bytes = Buffer.concat(chunks); assert.equal(bytes.length, prepared.byteLength); assert.equal(sha256(bytes), prepared.sha256);
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
  } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: String(error) })); }
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

const cases = [
  { id: "cq-ww-cw", name: "WW CW operator acceptance", mode: "CW", style: "run", format: "cabrillo", exchange: "05", reports: "599", expected: { points: 4, multipliers: 4, score: 16 } },
  { id: "cq-wpx-cw", name: "WPX CW operator acceptance", mode: "CW", style: "search-and-pounce", format: "adif", exchange: "123", reports: "599", expected: { points: 5, multipliers: 2, score: 10 } },
  { id: "cq-ww-ssb", name: "WW SSB operator acceptance", mode: "SSB", style: "run", format: "adif", exchange: "05", reports: "59", expected: { points: 4, multipliers: 4, score: 16 } },
  { id: "cq-wpx-ssb", name: "WPX SSB operator acceptance", mode: "SSB", style: "search-and-pounce", format: "cabrillo", exchange: "123", reports: "59", expected: { points: 5, multipliers: 2, score: 10 } },
];

async function createCase(item) {
  await fill("Session name", item.name); await select("Contest", item.id); await fill("Station callsign", "OM0RX"); await fill("Operator callsign", "OM0RX"); await fill("CQ zone", "15"); await fill("DXCC entity", "Slovak Republic"); await click("Create and open"); await waitText(item.name);
  await select("Operating style", item.style);
  if (item.style === "run") { await fill("Frequency Hz", "14025000"); await select("Band", "20m"); await waitEnabledButton("Arm simulation"); await click("Arm simulation"); await waitText("Armed for simulated output"); await pressIn("Contest callsign", "Enter"); await waitText("CQ"); }
  const contacts = [{ call: "K1ABC", rx: item.exchange, frequency: "14025000", band: "20m" }, { call: "DL1ABC", rx: item.id.includes("wpx") ? "124" : "14", frequency: "7025000", band: "40m" }];
  for (const [index, contact] of contacts.entries()) {
    await fill("Contest callsign", contact.call); await fill("Received report", item.reports); await fill("Frequency Hz", contact.frequency); await select("Band", contact.band);
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
    await pressIn("Received exchange", "Enter"); await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
    observations.push({ case: item.id, contact: index, phase: "after-enter", operator: await text("[aria-label='Run and S&P simulation']") });
    await waitText(`${index + 1} contacts`);
    if (index === 0 && !item.id.includes("wpx")) { await fill("Contest callsign", contact.call); await fill("Received exchange", contact.rx); await fill("Frequency Hz", contact.frequency); await select("Band", contact.band); await new Promise(resolveDelay => setTimeout(resolveDelay, 350)); await waitText("Duplicate"); await fill("Contest callsign", ""); }
  }
  if (item.id.includes("wpx")) {
    await fill("Contest callsign", "DL1ABC"); await fill("Received exchange", "124"); await fill("Frequency Hz", "7025000"); await select("Band", "40m");
    await waitEnabledButton("Reserve serial"); await click("Reserve serial"); await waitText("Duplicate");
  }
  await expectText("[aria-label='Score and multipliers']", new RegExp(`Claimed score\\s*${item.expected.score}.*QSOs\\s*2.*Points\\s*${item.expected.points}.*Multipliers\\s*${item.expected.multipliers}`, "s"));
  await browser(["screenshot", join(evidenceRoot, `${item.id}.png`)]);
  await click("Export…"); await select("Format", item.format); await fill("Location", "DX"); await fill("Name", "Oliver Acceptance"); await click("Prepare export"); await waitText(item.format === "cabrillo" ? "Cabrillo submission preview" : "ADIF compatibility export"); await click("Save…"); await waitText("Saved");
  await click("Contest Manager"); await waitText("Contest sessions");
}

let primaryFailure = null;
try {
  await browser(["open", url]); await waitText("Contest Workspace");
  for (const item of cases) await createCase(item);
  await successful("__acceptance_restart"); await waitText(cases[0].name);
  await browser(["eval", `(() => { const button=[...document.querySelectorAll('button')].find(x=>x.textContent.includes(${JSON.stringify(cases[0].name)})); if(!button) throw new Error('Missing session button'); button.click(); })()`]); await waitText("Plain Log");
  await expectText("[aria-label='Contest log']", /2 contacts/); await click("Edit K1ABC");
  await browser(["eval", `(() => { const root=document.querySelector('.contest-qso-editor'); const label=[...root.querySelectorAll('label')].find(x=>x.textContent.startsWith('Received exchange')); const input=label.querySelector('input'); const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'04'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`]);
  await fill("Correction note", "Synthetic acceptance correction"); await click("Save correction"); await waitText("Saved K1ABC");
  await click("Edit DL1ABC"); await waitText("Update the contact"); await click("Delete contact"); await fill("Deletion note", "Synthetic acceptance deletion"); await click("Confirm deletion"); await waitText("Deleted DL1ABC"); await expectText("[aria-label='Contest log']", /1 contacts/);
  await browser(["screenshot", join(evidenceRoot, "restart-correction-deletion.png")]); await browser(["close"], false);
  const status = await successful("workspace_status"); assert.deepEqual({ qso: status.qso_count, pending: status.pending_sync_count, outbox: status.outbox_count }, { qso: 0, pending: 0, outbox: 0 });
  assert.equal(simulatedOutput.some(item => item.macro === "CQ"), true); assert.equal(simulatedOutput.some(item => item.macro === "EXCH"), true);
  const commits = frames.filter(item => item.request.method === "contest_qso_commit" && item.response.ok).map(item => item.response.result);
  assert.equal(commits.length, 8); assert.deepEqual(commits.filter(item => item.session.rule.identity.id.includes("wpx")).map(item => item.qso.sentExchange), ["001", "002", "001", "002"]);
} catch (error) { primaryFailure = error; }
finally { try { await browser(["close"], false); } catch {} try { await successful("__acceptance_shutdown"); } catch {} try { await vite.close(); } catch {} await new Promise(resolveClose => server.close(resolveClose)); }

const inventory = rootPath => { const rows = []; const visit = (path, relative) => { const value = lstatSync(path); assert.equal(value.isSymbolicLink(), false); if (value.isDirectory()) for (const name of readdirSync(path).sort()) visit(join(path, name), relative ? `${relative}/${name}` : name); else rows.push({ path: relative, size: value.size, sha256: hashFile(path) }); }; visit(rootPath, ""); return rows; };
const protectedAfter = Object.fromEntries(protectedPaths.map(path => [path, metadata(path)]));
if (primaryFailure === null) { try { assert.deepEqual(protectedAfter, protectedBefore, "Protected production database metadata changed."); } catch (error) { primaryFailure = error; } }
const evidence = { schemaVersion: 1, ok: primaryFailure === null, boundary: "Headless Vite UI driving a SwiftPM test host around the real isolated LiveWorker; not a packaged worker/app, native window, RF, audio, PTT, hardware, or sponsor-submission acceptance.", source: { expectedHead, actualHead, dirty: gitStatus.length > 0, status: gitStatus, trackedDiffBytes: trackedDiff.length, trackedDiffSha256: sha256(trackedDiff), untrackedSourceDigests }, testHost: { path: testHostBinary, sha256: testHostSha256 }, testRunner: { path: testRunnerBinary, sha256: testRunnerSha256 }, processRecoveryProbe, runID, url, cases, actions, observations, simulatedOutput, lifecycle, frameCount: frames.length, frames, exports: inventory(exportRoot), syntheticInventory: inventory(isolatedHome), protectedDatabaseMetadataUnchanged: JSON.stringify(protectedAfter) === JSON.stringify(protectedBefore), failure: primaryFailure ? String(primaryFailure.stack || primaryFailure) : null };
writeFileSync(join(evidenceRoot, "acceptance.json"), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdin.destroy();
if (primaryFailure) throw primaryFailure;
assert.ok(frames.length > 0);
process.stderr.write(`${JSON.stringify({ ok: true, sourceHead: expectedHead, testHostSha256, frames: frames.length, exports: evidence.exports.length, evidence: join(evidenceRoot, "acceptance.json") })}\n`);
