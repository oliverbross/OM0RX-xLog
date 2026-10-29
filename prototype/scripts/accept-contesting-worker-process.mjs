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
import { currentContestScenario, rejectionAssertions } from "./contesting-worker-current-scenario.mjs";

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scenarioPath = join(scriptRoot, "prototype/scripts/contesting-worker-current-scenario.mjs");
const scenarioSHA256 = createHash("sha256").update(readFileSync(scenarioPath)).digest("hex");
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
const requestedOutputRoot = option("--output");
const buildManifestBytes = readFileSync(buildManifestPath);
const buildManifest = JSON.parse(buildManifestBytes);
assert.equal(buildManifest.schemaVersion, 2, "Unsupported worker build manifest.");
assert.equal(buildManifest.sourceHead, expectedHead, "Worker build manifest source does not match the required commit.");
assert.equal(buildManifest.compiledInputsClean, true, "Worker build manifest did not record clean compiled inputs.");
const sourceWorker = resolve(buildManifest.worker.path);
assert.ok(buildManifest.resources && typeof buildManifest.resources === "object"
  && !Array.isArray(buildManifest.resources), "Worker build manifest resources are missing.");
assert.deepEqual(Object.keys(buildManifest.resources).sort(), ["contest", "logbook"],
  "Worker build manifest must contain exactly the contest and logbook resource records.");
for (const value of Object.values(buildManifest.resources)) {
  assert.equal(typeof value?.path, "string", "Worker resource path is invalid.");
  assert.ok(Array.isArray(value.files), "Worker resource file manifest is invalid.");
  assert.match(value.treeSha256 ?? "", /^[0-9a-f]{64}$/, "Worker resource tree digest is invalid.");
}
const sourceResources = Object.fromEntries(Object.entries(buildManifest.resources).map(([kind, value]) => [
  kind, resolve(value.path),
]));
assert.equal(process.platform, "darwin", "This acceptance gate is macOS-specific.");
assert.ok(existsSync(sourceWorker) && statSync(sourceWorker).isFile(), "Built worker is missing.");
for (const [kind, path] of Object.entries(sourceResources)) {
  assert.ok(existsSync(path) && statSync(path).isDirectory(), `${kind} worker resources are missing.`);
}
assert.ok(!existsSync(requestedOutputRoot), "Acceptance output must be a new path.");
mkdirSync(requestedOutputRoot, { recursive: true });
const outputRoot = realpathSync(requestedOutputRoot);

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
for (const path of Object.values(sourceResources)) {
  cpSync(path, join(contents, "Resources", basename(path)), { recursive: true });
}
writeFileSync(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>xlog-prototype-worker</string>
<key>CFBundleIdentifier</key><string>${bundleID}</string>
<key>CFBundleName</key><string>OM0RX-xLog Contesting Worker Bootstrap</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
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

// Exercise the same bundled Python/CA/Not1MM closure as the process-owning
// worker. The relocator accepts only this named fixture in a private root;
// production bundle path and runtime guards stay in force.
const pythonFramework = process.env.XLOG_PYTHON_FRAMEWORK ??
  (existsSync("/opt/local/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12")
    ? "/opt/local/Library/Frameworks/Python.framework" : "/opt/homebrew/opt/python@3.12/Frameworks/Python.framework");
run(join(pythonFramework, "Versions/3.12/bin/python3.12"), ["-I", "-B",
  join(scriptRoot, "prototype/scripts/relocate-contest-python.py"),
  "--bundle", realpathSync(fixture), "--acceptance-root", realpathSync(outputRoot),
  "--source-framework", pythonFramework, "--packaging-script", "accept-contesting-worker-process.mjs"]);
const runtimeManifestPath = join(contents, "Resources/Not1MM/python-runtime.json");
const runtimeManifest = JSON.parse(readFileSync(runtimeManifestPath, "utf8"));
assert.equal(runtimeManifest.acceptance.externalLibrariesLoaded, false);
assert.equal(runtimeManifest.acceptance.relocated, true);
assert.ok(runtimeManifest.caBundle.certificateCount > 0);

function runtimeReceipt() {
  return { manifestSHA256: hashFile(runtimeManifestPath),
    native: runtimeManifest.packagedMachO.map(item => ({ path: item.path,
      sha256: hashFile(join(contents, "Frameworks/Python.framework", item.path)) })),
    host: resourceManifest(join(contents, "Resources/Not1MM/python")),
    caSHA256: hashFile(join(contents, "Frameworks/Python.framework", runtimeManifest.caBundle.bundledPath)) };
}
const stagedRuntimeBefore = runtimeReceipt();
assert.deepEqual(stagedRuntimeBefore.native, runtimeManifest.packagedMachO.map(({ path, sha256 }) => ({ path, sha256 })));
assert.equal(stagedRuntimeBefore.caSHA256, runtimeManifest.caBundle.sha256);

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
for (const [kind, path] of Object.entries(sourceResources)) {
  assert.deepEqual(resourceManifest(path), {
    files: buildManifest.resources[kind].files,
    treeSha256: buildManifest.resources[kind].treeSha256,
  }, `${kind} worker resources do not match their build manifest.`);
}

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
const stagedResourcesBefore = Object.fromEntries(Object.entries(sourceResources).map(([kind, path]) => [
  kind, resourceManifest(join(contents, "Resources", basename(path))),
]));
assert.deepEqual(stagedWorkerBefore, { size: buildManifest.worker.size, sha256: buildManifest.worker.sha256 },
  "Staged worker does not match the recorded build artifact.");
assert.deepEqual(stagedResourcesBefore, Object.fromEntries(Object.entries(buildManifest.resources).map(
  ([kind, value]) => [kind, { files: value.files, treeSha256: value.treeSha256 }]
)), "Staged resources do not match the recorded build artifact.");
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
  const exchange = { operation: exchanges.length + 1, process: worker.label, method, request: null, response: null };
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
const scenario = await currentContestScenario({ first, record, success: expectSuccess, error: expectError,
  WorkerProcess, inspectDescriptors, assertNormalWorkspaceEmpty, evidenceRoot });
assert.equal(exchanges.length, 81, "The current-engine process acceptance ledger changed unexpectedly.");
return { missingProfile, ...scenario, operationCount: exchanges.length };
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
const stagedResourcesAfter = finalInspection("stagedResources", () => Object.fromEntries(
  Object.entries(sourceResources).map(([kind, path]) => [
    kind, resourceManifest(join(contents, "Resources", basename(path))),
  ])), null);
const stagedRuntimeAfter = finalInspection("stagedRuntime", runtimeReceipt, null);
const stagedArtifactsUnchanged = stagedWorkerAfter !== null && stagedResourcesAfter !== null
  && JSON.stringify(stagedWorkerAfter) === JSON.stringify(stagedWorkerBefore)
  && JSON.stringify(stagedResourcesAfter) === JSON.stringify(stagedResourcesBefore)
  && JSON.stringify(stagedRuntimeAfter) === JSON.stringify(stagedRuntimeBefore)
  && hashFile(scenarioPath) === scenarioSHA256;
if (!stagedArtifactsUnchanged && !failure) failure = { name: "AssertionError", message: "Staged worker artifacts changed during acceptance." };
if (inspectionErrors.length > 0 && !failure) {
  failure = { name: "InspectionError", message: "One or more final acceptance inspections failed." };
}

const evidence = {
  schemaVersion: 1,
  runID,
  boundary: {
    fixtureKind: "worker-bootstrap-with-verified-contest-runtime",
    finalApplicationPackage: false,
    rustHostExercised: false,
    installed: false,
    launchedApplicationUI: false,
    networkSocketsObserved: completed ? false : "acceptance_incomplete",
    radioDeviceDescriptorsObserved: completed ? false : "acceptance_incomplete",
    healthReportedCredentialAccess: completed ? false : "acceptance_incomplete",
  },
  source: {
    currentScenario: { path: scenarioPath, sha256: scenarioSHA256,
      unchanged: hashFile(scenarioPath) === scenarioSHA256 },
    expectedHead, observedHead: head, buildManifestPath,
    buildManifestSha256: createHash("sha256").update(buildManifestBytes).digest("hex"),
    buildManifest, workerSourcePath: sourceWorker,
    workerSha256: buildManifest.worker.sha256, resourcesSourcePath: sourceResources,
    resourcesName: Object.fromEntries(Object.entries(sourceResources).map(([kind, path]) => [kind, basename(path)])),
    dirtyPathsAtRun: status,
    packageManifestDiffSha256: createHash("sha256").update(manifestDiff).digest("hex"),
    packageManifestDirty: manifestDiff.length > 0,
  },
  stagedArtifacts: { before: { worker: stagedWorkerBefore, resources: stagedResourcesBefore, runtime: stagedRuntimeBefore },
    after: { worker: stagedWorkerAfter, resources: stagedResourcesAfter, runtime: stagedRuntimeAfter }, unchanged: stagedArtifactsUnchanged },
  contestRuntime: runtimeManifest,
  foundationProbe: observations.foundationProbe && { ...observations.foundationProbe,
    matchedBeforeWorkerSpawn: resolve(observations.foundationProbe.resolvedApplicationSupport) === resolve(applicationSupport) },
  profile: { bundleID, argument: profileArgument, missingProfile: observations.missingProfile },
  paths: { outputRoot, fixture, isolatedHome, workerSupportRoot, supportRootObserved },
  protectedProductionMetadata: { before: protectedBefore, after: protectedAfter, equal: protectedMetadataEqual, contentsRead: false },
  descriptorChecks: completed ? { firstStartup: completed.descriptorEvidenceFirst,
    afterMutations: completed.descriptorEvidenceAfterMutations, restart: completed.descriptorEvidenceRestart } : null,
  operationCount: exchanges.length,
  contestMutation: completed?.contestMutation ?? null,
  rejectedRequests: completed?.rejectedRequests ?? null,
  processes: workerProcesses.map(worker => ({ label: worker.label, pid: worker.child.pid, exit: worker.exit,
    stderr: worker.stderr, responseFrames: worker.frames.length })),
  assertions: {
    onboardingBeforeWorkspace: Boolean(completed), emptyWorkspaceCreated: Boolean(completed), cqWWCommitted: Boolean(completed),
    cqWPXReservedAndCommitted: Boolean(completed), exactCommitReplay: Boolean(completed), receiptSurvivedRestart: Boolean(completed),
    fullQSOReadBeforeEdit: Boolean(completed), countryChangingCorrection: Boolean(completed), forgedEntityRejected: Boolean(completed),
    ...rejectionAssertions(completed?.rejectedRequests), deletionTombstoneObserved: Boolean(completed),
    exactQSOChangeReplayAfterRestart: Boolean(completed), qsoChangeReceiptsSurvivedRestart: Boolean(completed),
    postEditDraftDupeRevalidated: Boolean(completed), serialAllocationContinued: Boolean(completed),
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
