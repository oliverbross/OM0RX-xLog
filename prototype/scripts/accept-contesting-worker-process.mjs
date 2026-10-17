#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync,
  readdirSync, readFileSync, realpathSync, statSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bundleID = "com.oliverbross.xlog.contesting-test";
const profileArgument = "--runtime-profile=contesting-test";

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
  return resolve(process.argv[index + 1]);
}
function valueOption(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
  return process.argv[index + 1];
}

const buildManifestPath = option("--build-manifest");
const expectedHead = valueOption("--expected-head");
const outputRoot = option("--output");
const buildManifestBytes = readFileSync(buildManifestPath);
const buildManifest = JSON.parse(buildManifestBytes);
assert.equal(buildManifest.schemaVersion, 1, "Unsupported worker build manifest.");
assert.equal(buildManifest.sourceHead, expectedHead, "Worker build manifest source does not match the required commit.");
assert.equal(buildManifest.compiledInputsClean, true, "Worker build manifest did not record clean compiled inputs.");
const sourceWorker = resolve(buildManifest.worker.path);
const sourceResources = resolve(buildManifest.resources.path);
assert.equal(process.platform, "darwin", "This acceptance gate is macOS-specific.");
assert.ok(existsSync(sourceWorker) && statSync(sourceWorker).isFile(), "Built worker is missing.");
assert.ok(existsSync(sourceResources) && statSync(sourceResources).isDirectory(), "Worker resources are missing.");
assert.ok(!existsSync(outputRoot), "Acceptance output must be a new path.");

const runID = randomUUID().toLowerCase();
const fixture = join(outputRoot, "bootstrap", "OM0RX-xLog Contesting Worker Bootstrap.app");
const contents = join(fixture, "Contents");
const executable = join(contents, "MacOS", "xlog-prototype-worker");
const isolatedHome = join(outputRoot, "isolated-home");
const applicationSupport = join(isolatedHome, "Library", "Application Support");
const tempRoot = join(outputRoot, "tmp");
const evidenceRoot = join(outputRoot, "evidence");
for (const path of [dirname(executable), join(contents, "Resources"), applicationSupport, tempRoot, evidenceRoot]) {
  mkdirSync(path, { recursive: true });
}
copyFileSync(sourceWorker, executable);
chmodSync(executable, 0o755);
cpSync(sourceResources, join(contents, "Resources", basename(sourceResources)), { recursive: true });
writeFileSync(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>xlog-prototype-worker</string>
<key>CFBundleIdentifier</key><string>${bundleID}</string>
<key>CFBundleName</key><string>OM0RX-xLog Contesting Worker Bootstrap</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>\n`);

function run(command, args, options = {}) {
  const { allowFailure = false, ...spawnOptions } = options;
  const result = spawnSync(command, args, { encoding: "utf8", ...spawnOptions });
  if (result.error) throw result.error;
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status}): ${result.stderr}`);
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function resourceManifest(directory) {
  const files = [];
  function visit(path, relative) {
    const value = lstatSync(path);
    assert.equal(value.isSymbolicLink(), false, `Resource bundle contains a symlink: ${relative}`);
    if (value.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name), relative ? `${relative}/${name}` : name);
    } else if (value.isFile()) {
      files.push({ path: relative, size: value.size, sha256: hashFile(path) });
    } else throw new Error(`Unexpected resource entry: ${relative}`);
  }
  visit(directory, "");
  return { files, treeSha256: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}

assert.equal(hashFile(sourceWorker), buildManifest.worker.sha256, "Built worker does not match its build manifest.");
assert.deepEqual(resourceManifest(sourceResources), {
  files: buildManifest.resources.files,
  treeSha256: buildManifest.resources.treeSha256,
}, "Worker resources do not match their build manifest.");

function metadata(path) {
  try {
    const value = lstatSync(path, { bigint: true });
    return {
      exists: true, device: value.dev.toString(), inode: value.ino.toString(),
      size: value.size.toString(), modifiedNs: value.mtimeNs.toString(), changedNs: value.ctimeNs.toString(),
      kind: value.isSymbolicLink() ? "symlink" : value.isDirectory() ? "directory" : value.isFile() ? "file" : "other",
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
}

const protectedPaths = [
  join(homedir(), "Library", "Application Support", "OM0RX-xLog", "OM0RX-xLog.sqlite"),
  join(homedir(), "Library", "Application Support", "OM0RX-xLog-Integrated Preview", "OM0RX-xLog.sqlite"),
].flatMap(path => [path, `${path}-wal`, `${path}-shm`]);
function protectedMetadata() {
  return Object.fromEntries(protectedPaths.map(path => [path, metadata(path)]));
}

function inventory(root) {
  const rows = [];
  function visit(path, relative) {
    const value = lstatSync(path);
    assert.equal(value.isSymbolicLink(), false, `Synthetic acceptance root contains a symlink: ${relative}`);
    if (value.isDirectory()) {
      rows.push({ path: relative || ".", kind: "directory" });
      for (const name of readdirSync(path).sort()) visit(join(path, name), relative ? `${relative}/${name}` : name);
    } else if (value.isFile()) {
      rows.push({ path: relative, kind: "file", size: value.size, sha256: hashFile(path) });
    } else {
      throw new Error(`Unexpected synthetic filesystem entry: ${relative}`);
    }
  }
  visit(root, "");
  return rows;
}

function childEnvironment() {
  return {
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LANG: "en_US.UTF-8",
    LC_ALL: "en_US.UTF-8",
    TZ: "UTC",
    CFFIXED_USER_HOME: isolatedHome,
    TMPDIR: tempRoot,
    XDG_CACHE_HOME: join(isolatedHome, ".cache"),
    XDG_CONFIG_HOME: join(isolatedHome, ".config"),
    XDG_DATA_HOME: join(isolatedHome, ".local", "share"),
  };
}

async function within(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const stagedWorkerBefore = { size: statSync(executable).size, sha256: hashFile(executable) };
const stagedResourcesBefore = resourceManifest(join(contents, "Resources", basename(sourceResources)));
assert.deepEqual(stagedWorkerBefore, { size: buildManifest.worker.size, sha256: buildManifest.worker.sha256 },
  "Staged worker does not match the recorded build artifact.");
assert.deepEqual(stagedResourcesBefore, {
  files: buildManifest.resources.files, treeSha256: buildManifest.resources.treeSha256,
}, "Staged resources do not match the recorded build artifact.");
const workerProcesses = [];
class WorkerProcess {
  constructor(label) {
    this.label = label;
    this.frames = [];
    this.stderr = "";
    this.pending = new Map();
    this.buffer = "";
    this.exit = null;
    this.child = spawn(executable, [profileArgument], {
      cwd: outputRoot, env: childEnvironment(), stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stderr.on("data", chunk => { this.stderr += chunk.toString("utf8"); });
    this.child.stdout.on("data", chunk => {
      try { this.consume(chunk.toString("utf8")); }
      catch (error) { this.failPending(error); this.child.kill("SIGTERM"); }
    });
    this.closed = new Promise((resolveClose, rejectClose) => {
      this.child.once("error", rejectClose);
      this.child.once("close", (code, signal) => {
        this.exit = { code, signal };
        this.failPending(new Error(`${this.label} exited before completing its requests.`));
        resolveClose(this.exit);
      });
    });
    workerProcesses.push(this);
  }

  failPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  consume(text) {
    this.buffer += text;
    let newline;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      const frame = JSON.parse(line);
      this.frames.push(frame);
      const pending = this.pending.get(frame.id);
      if (!pending) throw new Error(`Unexpected response ID ${frame.id}.`);
      this.pending.delete(frame.id);
      pending.resolve(frame);
    }
  }

  async request(method, params = {}, dispatched = () => {}) {
    const id = `${this.label}-${String(this.frames.length + this.pending.size + 1).padStart(3, "0")}`;
    const request = { id, method, params };
    dispatched(request);
    const response = await new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectRequest(new Error(`Timed out waiting for ${method}.`));
      }, 20_000);
      this.pending.set(id, {
        resolve: frame => { clearTimeout(timer); resolveRequest(frame); },
        reject: error => { clearTimeout(timer); rejectRequest(error); },
      });
      this.child.stdin.write(`${JSON.stringify(request)}\n`, error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); rejectRequest(error); }
      });
    });
    return { request, response };
  }

  async stop() {
    assert.equal(this.pending.size, 0, "Worker still has pending requests.");
    this.child.stdin.end();
    const status = await this.closeWithin(10_000);
    assert.deepEqual(status, { code: 0, signal: null }, `${this.label} did not stop cleanly.`);
    assert.equal(this.buffer, "", `${this.label} left a partial stdout frame.`);
    assert.equal(this.stderr, "", `${this.label} wrote unexpected diagnostics: ${this.stderr}`);
    return status;
  }

  async closeWithin(milliseconds) {
    return within(this.closed, milliseconds, `${this.label} did not exit within ${milliseconds}ms.`);
  }

  async terminate() {
    if (this.exit) return this.exit;
    this.child.stdin.destroy();
    this.child.kill("SIGTERM");
    try { return await this.closeWithin(2_000); }
    catch {
      this.child.kill("SIGKILL");
      return this.closeWithin(2_000).catch(() => ({ code: null, signal: "unreaped" }));
    }
  }
}

function expectSuccess(exchange) {
  assert.equal(exchange.response.id, exchange.request.id);
  assert.equal(exchange.response.ok, true, JSON.stringify(exchange.response));
  return exchange.response.result;
}

function expectError(exchange, code, outcome = "confirmed") {
  assert.equal(exchange.response.id, exchange.request.id);
  assert.equal(exchange.response.ok, false, JSON.stringify(exchange.response));
  assert.equal(exchange.response.error.code, code);
  assert.equal(exchange.response.error.outcome, outcome);
  return exchange.response.error;
}

function mutation({ sessionID, generation, requestID, revision, timestamp, payload, draftID }) {
  const value = {
    sessionID, workspaceGeneration: generation, requestID, expectedRevision: revision,
    payloadDigest: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    operationTimestamp: timestamp, payload,
  };
  if (draftID) value.draftID = draftID;
  return value;
}

function rule(catalog, id) {
  const found = catalog.rules.find(value => value.identity.id === id);
  assert.ok(found, `Catalog is missing ${id}.`);
  return found;
}

function createPayload({ sessionID, name, metadata }) {
  return {
    sessionID, name, ruleIdentity: metadata.identity,
    referenceDataVersion: metadata.referenceDataVersion,
    station: { callsign: "OM0RX", cqZone: "15", dxccEntity: "SLOVAK REPUBLIC" },
    operator: { callsign: "OM0RX", category: "single-op" },
  };
}

async function inspectDescriptors(worker) {
  const sockets = run("/usr/sbin/lsof", ["-nP", "-a", "-p", String(worker.child.pid), "-i"], { allowFailure: true });
  assert.ok([0, 1].includes(sockets.status), `lsof socket inspection failed: ${sockets.stderr}`);
  assert.equal(sockets.stdout.trim(), "", `Worker opened a network socket:\n${sockets.stdout}`);
  const descriptors = run("/usr/sbin/lsof", ["-Fn", "-p", String(worker.child.pid)], { allowFailure: true });
  assert.equal(descriptors.status, 0, `lsof descriptor inspection failed: ${descriptors.stderr}`);
  const devicePaths = descriptors.stdout.split("\n").filter(line => /^n\/dev\/(?:cu\.|tty\.|hid|usb|rfcomm)/i.test(line));
  assert.deepEqual(devicePaths, [], `Worker opened hardware descriptors: ${devicePaths.join(", ")}`);
  return { sockets: sockets.stdout, devicePaths };
}

async function missingProfileAttempt() {
  const child = spawn(executable, [], { cwd: outputRoot, env: childEnvironment(), stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "", exit = null;
  child.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  const closed = new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code, signal) => { exit = { code, signal }; resolveClose(exit); });
  });
  let timedOut = false, cleanupError = null;
  try {
    child.stdin.end();
    try { await within(closed, 5_000, "Missing-profile worker did not exit within 5 seconds."); }
    catch { timedOut = true; }
  } finally {
    if (!exit) {
      child.kill("SIGTERM");
      try { await within(closed, 1_000, "Missing-profile worker ignored SIGTERM."); }
      catch {
        child.kill("SIGKILL");
        try { await within(closed, 1_000, "Missing-profile worker was not reaped after SIGKILL."); }
        catch (error) { cleanupError = error.message; }
      }
    }
  }
  return { exit, stdout, stderr, timedOut, cleanupError };
}

const head = run("git", ["-C", scriptRoot, "rev-parse", "HEAD"]).stdout.trim();
assert.equal(head, expectedHead, "Acceptance must run from the reviewed integrated source commit.");
const status = run("git", ["-C", scriptRoot, "status", "--porcelain=v1"]).stdout.trim().split("\n").filter(Boolean);
const dirtyCompiledInputs = status.map(line => line.slice(3)).filter(path =>
  path === "Package.swift" || path.startsWith("Sources/") || path.startsWith("Tests/"));
assert.deepEqual(dirtyCompiledInputs, [], `Compiled inputs differ from ${expectedHead}: ${dirtyCompiledInputs.join(", ")}`);
const manifestDiff = run("git", ["-C", scriptRoot, "diff", "--", "Package.swift"]).stdout;
const protectedBefore = protectedMetadata();
const exchanges = [];
const observations = { missingProfile: null, foundationProbe: null };
const record = async (worker, method, params = {}) => {
  const exchange = { request: null, response: null };
  exchanges.push(exchange);
  const result = await worker.request(method, params, request => { exchange.request = request; });
  exchange.response = result.response;
  return exchange;
};

function assertNormalWorkspaceEmpty(status) {
  assert.equal(status.workspace_exists, true);
  assert.equal(status.qso_count, 0);
  assert.equal(status.pending_sync_count, 0);
  assert.equal(status.outbox_count, 0);
}

async function performAcceptance() {
const foundationProbe = run(buildManifest.toolchain.swiftPath, [
  join(scriptRoot, "prototype", "scripts", "foundation-application-support-probe.swift"),
], { cwd: outputRoot, env: childEnvironment() });
observations.foundationProbe = { toolchain: buildManifest.toolchain.swiftPath,
  resolvedApplicationSupport: foundationProbe.stdout.trim(), expectedApplicationSupport: applicationSupport };
assert.equal(resolve(foundationProbe.stdout.trim()), resolve(applicationSupport),
  "Foundation did not resolve the synthetic Application Support directory.");

// The containing test bundle must still fail closed when the explicit profile is omitted.
const missingProfile = await missingProfileAttempt();
observations.missingProfile = missingProfile;
assert.equal(missingProfile.timedOut, false);
assert.equal(missingProfile.cleanupError, null);
assert.deepEqual(missingProfile.exit, { code: 2, signal: null });
assert.equal(missingProfile.stdout, "");
assert.equal(missingProfile.stderr, "Runtime profile validation failed.\n");

const first = new WorkerProcess("first");
const healthBefore = expectSuccess(await record(first, "health"));
assert.equal(healthBefore.mode, "contesting_test");
assert.equal(healthBefore.isolated_workspace, true);
assert.equal(healthBefore.network_contact, false);
assert.equal(healthBefore.credentials_accessed, false);
assert.equal(healthBefore.station_io, false);
const statusBefore = expectSuccess(await record(first, "workspace_status"));
assert.equal(statusBefore.workspace_exists, false);
assert.equal(statusBefore.native_log_exists, false);
expectError(await record(first, "contest_catalog"), "workspace_required");
const descriptorEvidenceFirst = await inspectDescriptors(first);

const workspaceCreated = expectSuccess(await record(first, "workspace_create", { mode: "empty" }));
assert.equal(workspaceCreated.qso_count, 0);
const statusAfter = expectSuccess(await record(first, "workspace_status"));
assert.equal(statusAfter.workspace_exists, true);
assert.equal(statusAfter.qso_count, 0);
const catalog = expectSuccess(await record(first, "contest_catalog"));
const generation = catalog.workspaceGeneration;
assert.match(generation, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

const wwSession = "81111111-2222-4333-8444-555555555555";
const wwCreateID = "81111111-2222-4333-9444-555555555555";
const wwApplyID = "81111111-2222-4333-a444-555555555555";
const wwCommitID = "81111111-2222-4333-b444-555555555555";
const wwPayload = createPayload({ sessionID: wwSession, name: "Synthetic CQ WW process acceptance", metadata: rule(catalog, "cq-ww-cw") });
const wwCreate = expectSuccess(await record(first, "contest_create", mutation({
  sessionID: wwSession, generation, requestID: wwCreateID, revision: 0,
  timestamp: "2026-10-17T03:00:00.000Z", payload: wwPayload,
})));
assert.equal(wwCreate.session.revision, 1);
const wwDraft = expectSuccess(await record(first, "contest_draft_get", { sessionID: wwSession, workspaceGeneration: generation }));
assert.equal(wwDraft.draft.draftID, wwCreateID);
const wwFields = { callsign: "K1ABC", sentReport: "599", sentExchange: "15", receivedReport: "599", receivedExchange: "5", frequencyHz: 14025000, band: "20m", mode: "CW" };
const wwApply = expectSuccess(await record(first, "contest_draft_apply", mutation({
  sessionID: wwSession, generation, requestID: wwApplyID, revision: 1, draftID: wwCreateID,
  timestamp: "2026-10-17T03:01:00.000Z", payload: { fields: wwFields },
})));
assert.deepEqual(wwApply.draft.validation.errors, []);
const wwCommitParams = mutation({
  sessionID: wwSession, generation, requestID: wwCommitID, revision: 2, draftID: wwCreateID,
  timestamp: "2026-10-17T03:02:00.000Z", payload: {},
});
const wwCommit = expectSuccess(await record(first, "contest_qso_commit", wwCommitParams));
assert.equal(wwCommit.qso.callsign, "K1ABC");
assert.deepEqual({ qsos: wwCommit.score.qsos, points: wwCommit.score.points,
  multipliers: wwCommit.score.multipliers, claimedScore: wwCommit.score.claimedScore },
{ qsos: 1, points: 3, multipliers: 2, claimedScore: 6 });
const wwScore = expectSuccess(await record(first, "contest_score", {
  sessionID: wwSession, workspaceGeneration: generation, expectedRevision: wwCommit.session.revision,
}));
assert.equal(wwScore.qsos, 1);
assert.deepEqual({ points: wwScore.points, multipliers: wwScore.multipliers, claimedScore: wwScore.claimedScore },
  { points: 3, multipliers: 2, claimedScore: 6 });
const wwReceiptParams = { sessionID: wwSession, workspaceGeneration: generation, requestID: wwCommitID, payloadDigest: wwCommitParams.payloadDigest };
const wwReceipt = expectSuccess(await record(first, "contest_operation_receipt", wwReceiptParams));
assert.equal(wwReceipt.status, "committed");
assert.deepEqual({ requestID: wwReceipt.receipt.requestID, payloadDigest: wwReceipt.receipt.payloadDigest,
  committedRevision: wwReceipt.receipt.committedRevision },
{ requestID: wwCommitID, payloadDigest: wwCommitParams.payloadDigest, committedRevision: wwCommit.session.revision });

const wpxSession = "82222222-2222-4333-8444-555555555555";
const wpxCreateID = "82222222-2222-4333-9444-555555555555";
const wpxReserveID = "82222222-2222-4333-a444-555555555555";
const wpxApplyID = "82222222-2222-4333-b444-555555555555";
const wpxCommitID = "82222222-2222-4333-8444-666666666666";
const wpxPayload = createPayload({ sessionID: wpxSession, name: "Synthetic CQ WPX process acceptance", metadata: rule(catalog, "cq-wpx-cw") });
const wpxCreate = expectSuccess(await record(first, "contest_create", mutation({
  sessionID: wpxSession, generation, requestID: wpxCreateID, revision: 0,
  timestamp: "2026-10-17T03:10:00.000Z", payload: wpxPayload,
})));
const wpxDraft = expectSuccess(await record(first, "contest_draft_get", { sessionID: wpxSession, workspaceGeneration: generation }));
assert.equal(wpxDraft.draft.draftID, wpxCreateID);
const wpxReserve = expectSuccess(await record(first, "contest_serial_reserve", mutation({
  sessionID: wpxSession, generation, requestID: wpxReserveID, revision: 1, draftID: wpxCreateID,
  timestamp: "2026-10-17T03:11:00.000Z", payload: {},
})));
assert.equal(wpxReserve.draft.reservedSerial, 1);
const wpxFields = { callsign: "DL1ABC", sentReport: "599", sentExchange: "001", receivedReport: "599", receivedExchange: "1", frequencyHz: 7025000, band: "40m", mode: "CW" };
const wpxApply = expectSuccess(await record(first, "contest_draft_apply", mutation({
  sessionID: wpxSession, generation, requestID: wpxApplyID, revision: 2, draftID: wpxCreateID,
  timestamp: "2026-10-17T03:12:00.000Z", payload: { fields: wpxFields },
})));
assert.equal(wpxApply.draft.reservedSerial, 1);
assert.deepEqual(wpxApply.draft.validation.errors, []);
const wpxCommitParams = mutation({
  sessionID: wpxSession, generation, requestID: wpxCommitID, revision: 3, draftID: wpxCreateID,
  timestamp: "2026-10-17T03:13:00.000Z", payload: {},
});
const wpxCommit = expectSuccess(await record(first, "contest_qso_commit", wpxCommitParams));
assert.equal(wpxCommit.qso.sentExchange, "001");
assert.deepEqual({ qsos: wpxCommit.score.qsos, points: wpxCommit.score.points,
  multipliers: wpxCommit.score.multipliers, claimedScore: wpxCommit.score.claimedScore },
{ qsos: 1, points: 2, multipliers: 1, claimedScore: 2 });
const wpxReplay = expectSuccess(await record(first, "contest_qso_commit", wpxCommitParams));
assert.deepEqual(wpxReplay, wpxCommit);

const wpxRevision = wpxCommit.session.revision;
const wpxLog = expectSuccess(await record(first, "contest_log_page", {
  sessionID: wpxSession, workspaceGeneration: generation, expectedRevision: wpxRevision, offset: 0, limit: 25,
}));
assert.equal(wpxLog.total, 1);
const wpxScore = expectSuccess(await record(first, "contest_score", {
  sessionID: wpxSession, workspaceGeneration: generation, expectedRevision: wpxRevision,
}));
assert.equal(wpxScore.qsos, 1);
assert.deepEqual({ points: wpxScore.points, multipliers: wpxScore.multipliers, claimedScore: wpxScore.claimedScore },
  { points: 2, multipliers: 1, claimedScore: 2 });
const wpxReceiptParams = { sessionID: wpxSession, workspaceGeneration: generation, requestID: wpxCommitID, payloadDigest: wpxCommitParams.payloadDigest };
const wpxReceipt = expectSuccess(await record(first, "contest_operation_receipt", wpxReceiptParams));
assert.equal(wpxReceipt.status, "committed");
assert.deepEqual({ requestID: wpxReceipt.receipt.requestID, payloadDigest: wpxReceipt.receipt.payloadDigest,
  committedRevision: wpxReceipt.receipt.committedRevision },
{ requestID: wpxCommitID, payloadDigest: wpxCommitParams.payloadDigest, committedRevision: wpxCommit.session.revision });
expectError(await record(first, "cluster_connect"), "external_io_disabled");
expectError(await record(first, "station_connect"), "external_io_disabled");
expectError(await record(first, "online_log_configure"), "external_io_disabled");
expectError(await record(first, "lookup_call"), "external_io_disabled");
assertNormalWorkspaceEmpty(expectSuccess(await record(first, "workspace_status")));
const descriptorEvidenceAfterMutations = await inspectDescriptors(first);
const firstExit = await first.stop();

const second = new WorkerProcess("restart");
const restartHealth = expectSuccess(await record(second, "health"));
assert.equal(restartHealth.mode, "contesting_test");
const restartStatus = expectSuccess(await record(second, "workspace_status"));
assertNormalWorkspaceEmpty(restartStatus);
const restartSessions = expectSuccess(await record(second, "contest_sessions"));
assert.equal(restartSessions.sessions.length, 2);
const reopenedWW = expectSuccess(await record(second, "contest_open", { sessionID: wwSession, workspaceGeneration: generation }));
assert.equal(reopenedWW.session.qsoCount, 1);
const reopenedWPX = expectSuccess(await record(second, "contest_open", { sessionID: wpxSession, workspaceGeneration: generation }));
assert.equal(reopenedWPX.session.qsoCount, 1);
const wwReceiptAfterRestart = expectSuccess(await record(second, "contest_operation_receipt", wwReceiptParams));
assert.deepEqual(wwReceiptAfterRestart, wwReceipt);
const receiptAfterRestart = expectSuccess(await record(second, "contest_operation_receipt", wpxReceiptParams));
assert.deepEqual(receiptAfterRestart, wpxReceipt);
assert.deepEqual(expectSuccess(await record(second, "contest_qso_commit", wwCommitParams)), wwCommit);
assert.deepEqual(expectSuccess(await record(second, "contest_qso_commit", wpxCommitParams)), wpxCommit);
const descriptorEvidenceRestart = await inspectDescriptors(second);
const secondExit = await second.stop();

return {
  missingProfile, descriptorEvidenceFirst, descriptorEvidenceAfterMutations, descriptorEvidenceRestart,
  firstExit, secondExit, first, second,
};
}

let completed = null;
let failure = null;
try {
  completed = await performAcceptance();
} catch (error) {
  failure = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) };
} finally {
  await Promise.all(workerProcesses.map(worker => worker.terminate()));
}
const inspectionErrors = [];
function finalInspection(name, inspect, fallback) {
  try { return inspect(); }
  catch (error) {
    inspectionErrors.push({ name, message: error instanceof Error ? error.message : String(error) });
    return fallback;
  }
}
const protectedAfter = finalInspection("protectedProductionMetadata", protectedMetadata, null);
const protectedMetadataEqual = protectedAfter !== null
  && JSON.stringify(protectedAfter) === JSON.stringify(protectedBefore);
if (!protectedMetadataEqual && !failure) failure = { name: "AssertionError", message: "Protected production database metadata changed or could not be reinspected." };
const workerSupportRoot = join(applicationSupport, "OM0RX-xLog Contesting Test");
const supportRootObserved = finalInspection("supportRoot", () => existsSync(workerSupportRoot)
  && realpathSync(workerSupportRoot).startsWith(realpathSync(isolatedHome) + "/"), false);
if (completed && !supportRootObserved && !failure) failure = { name: "AssertionError", message: "Worker did not use the synthetic Application Support root." };
const syntheticInventory = finalInspection("syntheticInventory",
  () => existsSync(isolatedHome) ? inventory(isolatedHome) : [], []);
const stagedWorkerAfter = finalInspection("stagedWorker", () => ({
  size: statSync(executable).size, sha256: hashFile(executable),
}), null);
const stagedResourcesAfter = finalInspection("stagedResources",
  () => resourceManifest(join(contents, "Resources", basename(sourceResources))), null);
const stagedArtifactsUnchanged = stagedWorkerAfter !== null && stagedResourcesAfter !== null
  && JSON.stringify(stagedWorkerAfter) === JSON.stringify(stagedWorkerBefore)
  && JSON.stringify(stagedResourcesAfter) === JSON.stringify(stagedResourcesBefore);
if (!stagedArtifactsUnchanged && !failure) failure = { name: "AssertionError", message: "Staged worker artifacts changed during acceptance." };
if (inspectionErrors.length > 0 && !failure) {
  failure = { name: "InspectionError", message: "One or more final acceptance inspections failed." };
}

const evidence = {
  schemaVersion: 1,
  runID,
  boundary: {
    fixtureKind: "minimal-worker-bootstrap-bundle",
    finalApplicationPackage: false,
    rustHostExercised: false,
    installed: false,
    launchedApplicationUI: false,
    networkSocketsObserved: completed ? false : "acceptance_incomplete",
    radioDeviceDescriptorsObserved: completed ? false : "acceptance_incomplete",
    healthReportedCredentialAccess: completed ? false : "acceptance_incomplete",
  },
  source: {
    expectedHead, observedHead: head, buildManifestPath,
    buildManifestSha256: createHash("sha256").update(buildManifestBytes).digest("hex"),
    buildManifest, workerSourcePath: sourceWorker,
    workerSha256: buildManifest.worker.sha256, resourcesSourcePath: sourceResources,
    resourcesName: basename(sourceResources), dirtyPathsAtRun: status,
    packageManifestDiffSha256: createHash("sha256").update(manifestDiff).digest("hex"),
    packageManifestDirty: manifestDiff.length > 0,
  },
  stagedArtifacts: { before: { worker: stagedWorkerBefore, resources: stagedResourcesBefore },
    after: { worker: stagedWorkerAfter, resources: stagedResourcesAfter }, unchanged: stagedArtifactsUnchanged },
  foundationProbe: observations.foundationProbe && { ...observations.foundationProbe,
    matchedBeforeWorkerSpawn: resolve(observations.foundationProbe.resolvedApplicationSupport) === resolve(applicationSupport) },
  profile: { bundleID, argument: profileArgument, missingProfile: observations.missingProfile },
  paths: { outputRoot, fixture, isolatedHome, workerSupportRoot, supportRootObserved },
  protectedProductionMetadata: { before: protectedBefore, after: protectedAfter, equal: protectedMetadataEqual, contentsRead: false },
  descriptorChecks: completed ? { firstStartup: completed.descriptorEvidenceFirst,
    afterMutations: completed.descriptorEvidenceAfterMutations, restart: completed.descriptorEvidenceRestart } : null,
  processes: workerProcesses.map(worker => ({ label: worker.label, pid: worker.child.pid, exit: worker.exit,
    stderr: worker.stderr, responseFrames: worker.frames.length })),
  assertions: {
    onboardingBeforeWorkspace: Boolean(completed), emptyWorkspaceCreated: Boolean(completed), cqWWCommitted: Boolean(completed),
    cqWPXReservedAndCommitted: Boolean(completed), exactCommitReplay: Boolean(completed), receiptSurvivedRestart: Boolean(completed),
    externalMethodsDenied: Boolean(completed), noNetworkSocketsObserved: Boolean(completed),
    noRadioDeviceDescriptorsObserved: Boolean(completed), protectedMetadataUnchanged: protectedMetadataEqual,
  },
  outcome: failure ? { ok: false, failure } : { ok: true },
  inspectionErrors,
  exchanges,
  syntheticInventory,
};
writeFileSync(join(evidenceRoot, "acceptance.json"), `${JSON.stringify(evidence, null, 2)}\n`);
writeFileSync(join(evidenceRoot, "worker-stdout.ndjson"), `${exchanges.map(value => JSON.stringify(value.response)).join("\n")}\n`);
writeFileSync(join(evidenceRoot, "worker-requests.ndjson"), `${exchanges.map(value => JSON.stringify(value.request)).join("\n")}\n`);
writeFileSync(join(evidenceRoot, "worker-stderr.log"), workerProcesses.map(worker => `[${worker.label}]\n${worker.stderr}`).join("\n"));
if (failure) {
  console.error(JSON.stringify({ ok: false, evidence: join(evidenceRoot, "acceptance.json"), failure: failure.message }));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, evidence: join(evidenceRoot, "acceptance.json"), exchanges: exchanges.length, files: syntheticInventory.length }));
}
