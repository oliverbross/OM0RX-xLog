#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
  return resolve(process.argv[index + 1]);
}

const binDirectory = option("--bin-directory");
const outputRoot = option("--output");
const workerSource = join(binDirectory, "xlog-prototype-worker");
const resourceNames = ["OM0RXXLogPrototype_XLogCore.bundle", "OM0RXXLogPrototype_XContestCore.bundle"];
for (const name of resourceNames) assert.ok(existsSync(join(binDirectory, name)), `Missing ${name}.`);
assert.ok(existsSync(workerSource), "Missing worker executable.");
assert.ok(!existsSync(outputRoot), "Relocation proof output must be a new path.");

const fixture = join(outputRoot, "Relocated Contest Worker.app");
const contents = join(fixture, "Contents");
const executable = join(contents, "MacOS", "xlog-prototype-worker");
const resources = join(contents, "Resources");
const isolatedHome = join(outputRoot, "home");
const tempRoot = join(outputRoot, "tmp");
mkdirSync(dirname(executable), { recursive: true });
mkdirSync(resources, { recursive: true });
mkdirSync(isolatedHome, { recursive: true });
mkdirSync(tempRoot, { recursive: true });
cpSync(workerSource, executable);
for (const name of resourceNames) cpSync(join(binDirectory, name), join(resources, name), { recursive: true });
writeFileSync(join(contents, "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>CFBundleExecutable</key><string>xlog-prototype-worker</string>
<key>CFBundleIdentifier</key><string>com.oliverbross.xlog.contesting-test</string>
<key>CFBundleName</key><string>Relocated Contest Worker</string><key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>\n`);

const originalContestResources = join(binDirectory, resourceNames[1]);
const hiddenContestResources = `${originalContestResources}.relocation-proof-${randomUUID()}`;
let child;
const frames = [];
let buffer = "";
let stderr = "";
const pending = new Map();
let childClosed;
let cleanupPromise;
let cancellationError;
let streamError;

function failPending(error) {
  for (const waiter of pending.values()) waiter.reject(error);
  pending.clear();
}

function latchStreamError(error) {
  streamError ??= error instanceof Error ? error : new Error(String(error));
  failPending(streamError);
}

function within(promise, milliseconds, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

async function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.stdin.destroy();
      child.kill("SIGTERM");
      try { await within(childClosed, 2_000, "Worker did not stop after SIGTERM."); }
      catch {
        child.kill("SIGKILL");
        await within(childClosed, 2_000, "Worker could not be reaped after SIGKILL.");
      }
    }
    if (existsSync(hiddenContestResources)) renameSync(hiddenContestResources, originalContestResources);
    assert.ok(existsSync(originalContestResources), "Original contest resource bundle was not restored.");
  })();
  return cleanupPromise;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    cancellationError = new Error(`Relocation proof cancelled by ${signal}.`);
    failPending(cancellationError);
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  });
}

function request(method, params = {}) {
  if (cancellationError) return Promise.reject(cancellationError);
  if (streamError) return Promise.reject(streamError);
  const id = `${method}-${pending.size + frames.length + 1}`;
  return new Promise((resolveRequest, rejectRequest) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`Timed out waiting for ${method}.`));
    }, 20_000);
    pending.set(id, {
      resolve: frame => { clearTimeout(timer); resolveRequest(frame); },
      reject: error => { clearTimeout(timer); rejectRequest(error); },
    });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => {
      if (error) latchStreamError(error);
    });
  });
}

try {
  renameSync(originalContestResources, hiddenContestResources);
  child = spawn(executable, ["--runtime-profile=contesting-test"], {
    cwd: outputRoot,
    env: {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", TZ: "UTC",
      CFFIXED_USER_HOME: isolatedHome, TMPDIR: tempRoot, XDG_CACHE_HOME: join(isolatedHome, ".cache"),
      XDG_CONFIG_HOME: join(isolatedHome, ".config"), XDG_DATA_HOME: join(isolatedHome, ".local", "share"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  childClosed = new Promise(resolveClose => child.once("close", (code, signal) => {
    const outcome = { code, signal };
    if (pending.size > 0) latchStreamError(new Error("Worker exited before completing its requests."));
    resolveClose(outcome);
  }));
  child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
  child.stdout.on("data", chunk => {
    try {
      buffer += chunk.toString("utf8");
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const frame = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        frames.push(frame);
        const waiter = pending.get(frame.id);
        if (!waiter) throw new Error(`Unexpected response ${frame.id}.`);
        pending.delete(frame.id);
        waiter.resolve(frame);
      }
    } catch (error) {
      latchStreamError(error);
    }
  });
  child.once("error", latchStreamError);
  child.stdin.on("error", latchStreamError);
  const created = await request("workspace_create", { mode: "empty" });
  assert.equal(created.ok, true, JSON.stringify(created));
  const catalog = await request("contest_catalog");
  assert.equal(catalog.ok, true, JSON.stringify(catalog));
  const packagedIDs = catalog.result.rules.filter(rule => rule.identity.version === "2.0.0-declarative-archive")
    .map(rule => rule.identity.id).sort();
  assert.deepEqual(packagedIDs, [
    "cwops-cwt", "cwops-open", "icwc-mst", "ten-ten-fallCW", "ten-ten-springCW",
    "ten-ten-summerPhone", "ten-ten-winterPhone",
  ]);
  child.stdin.end();
  const exit = await within(childClosed, 10_000, "Worker did not exit.");
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.equal(streamError, undefined, streamError?.message);
  assert.equal(cancellationError, undefined, cancellationError?.message);
  assert.equal(stderr, "");
  assert.equal(buffer, "");
  assert.equal(pending.size, 0);
  writeFileSync(join(outputRoot, "relocation-proof.json"), `${JSON.stringify({
    schemaVersion: 1, sourceBinDirectory: binDirectory, originalContestResourcesHidden: true,
    relocatedFixture: fixture, packagedIDs, requests: frames,
  }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, packagedDefinitions: packagedIDs.length,
    evidence: join(outputRoot, "relocation-proof.json") }));
} catch (error) {
  writeFileSync(join(outputRoot, "relocation-failure.json"), `${JSON.stringify({
    schemaVersion: 1, originalContestResourcesHidden: existsSync(hiddenContestResources),
    error: error instanceof Error ? error.message : String(error), frames,
  }, null, 2)}\n`);
  throw error;
} finally {
  await cleanup();
}
