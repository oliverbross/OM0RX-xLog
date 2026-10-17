#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runBoundedChild } from "./bounded-child-process.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const option = name => { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`); return process.argv[index + 1]; };
const expectedHead = option("--expected-head"), output = resolve(option("--output")), scratch = resolve(option("--scratch-path"));
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
function sourceState() {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const untracked = Object.fromEntries(status.filter(row => row.startsWith("?? ")).map(row => row.slice(3)).filter(path => {
    const absolute = join(root, path); return existsSync(absolute) && statSync(absolute).isFile();
  }).sort().map(path => [path, sha256(readFileSync(join(root, path)))]));
  return { head, status, trackedDiffSHA256: sha256(execFileSync("git", ["diff", "--binary", "HEAD", "--"], { cwd: root })), untracked };
}
const sourceBefore = sourceState();
assert.equal(sourceBefore.head, expectedHead);
assert.equal(existsSync(output), false, "Acceptance output must be new.");
const inherited = { ...process.env, XLOG_PORTABLE_ONLY: "1" };
const build = await runBoundedChild("swift", ["test", "list", "--jobs", "2", "--scratch-path", scratch],
  { cwd: root, env: inherited, timeoutMs: 900_000, terminateGraceMs: 2_000, processGroup: true, outputLimit: 4_000_000 });
const bundle = join(scratch, "out/Products/Debug/XLogPrototypeTests.xctest");
const host = join(bundle, "Contents/MacOS/XLogPrototypeTests");
assert.ok(existsSync(host), `Compiled test host missing at ${host}.`);
const xctest = "/Applications/Xcode.app/Contents/Developer/usr/bin/xctest";
const selector = "XLogPrototypeTests.ContestOperatorBrowserAcceptanceTests/testRealWorkspaceAndMutationOwnerAgainstIsolatedLiveWorker";
const baseEnvironment = { ...inherited, XLOG_RUN_CONTEST_OPERATOR_BROWSER_ACCEPTANCE: "1",
  XLOG_OPERATOR_ACCEPTANCE_SOURCE_HEAD: expectedHead, XLOG_OPERATOR_ACCEPTANCE_OUTER_GUARD: "owned-process-group-v1" };
async function expectStall(mode) {
  const probeOutput = `${output}-probe-${mode}`;
  try {
    await runBoundedChild(xctest, ["-XCTest", selector, bundle], { cwd: root,
      env: { ...baseEnvironment, XLOG_OPERATOR_ACCEPTANCE_OUTPUT: probeOutput, XLOG_OPERATOR_ACCEPTANCE_STALL: mode },
      timeoutMs: 3_000, terminateGraceMs: 500, processGroup: true, outputLimit: 1_000_000 });
    assert.fail(`${mode} stall unexpectedly completed.`);
  } catch (error) {
    assert.equal(error.code, "deadline_exceeded", JSON.stringify({ code: error.code, stdout: error.stdout, stderr: error.stderr })); assert.equal(error.processGroup, true);
    assert.ok(error.ownedPIDs.length >= 2, `${mode} probe did not include the host and Node descendant: ${JSON.stringify({ ownedPIDs: error.ownedPIDs, stdout: error.stdout, stderr: error.stderr })}`);
    assert.deepEqual(error.lingeringPIDs, []);
    return { mode, code: error.code, signal: error.signal, ownedPIDs: error.ownedPIDs, lingeringPIDs: error.lingeringPIDs,
      stdoutSHA256: createHash("sha256").update(error.stdout).digest("hex"), stderrSHA256: createHash("sha256").update(error.stderr).digest("hex") };
  }
}
const probes = [await expectStall("response"), await expectStall("shutdown")];
const run = await runBoundedChild(xctest, ["-XCTest", selector, bundle], { cwd: root,
  env: { ...baseEnvironment, XLOG_OPERATOR_ACCEPTANCE_OUTPUT: output }, timeoutMs: 240_000,
  terminateGraceMs: 2_000, processGroup: true, outputLimit: 4_000_000 });
const acceptancePath = join(output, "evidence/acceptance.json"), acceptance = JSON.parse(readFileSync(acceptancePath, "utf8"));
assert.equal(acceptance.ok, true); assert.equal(acceptance.source.actualHead, expectedHead);
const sourceAfter = sourceState();
assert.deepEqual(sourceAfter, sourceBefore, "Compiled source changed during the outer acceptance run.");
const outerEvidence = { schemaVersion: 1, ok: true, expectedHead, command: { xctest, selector, bundle, scratch },
  source: sourceBefore,
  build: { code: build.childExitCode, stdoutSHA256: createHash("sha256").update(build.stdout).digest("hex"), stderrSHA256: createHash("sha256").update(build.stderr).digest("hex") },
  host: { path: host, sha256: sha256(readFileSync(host)) }, probes,
  run: { code: run.childExitCode, stdoutSHA256: createHash("sha256").update(run.stdout).digest("hex"), stderrSHA256: createHash("sha256").update(run.stderr).digest("hex"), acceptancePath } };
mkdirSync(join(output, "evidence"), { recursive: true });
writeFileSync(join(output, "evidence/outer-runner.json"), `${JSON.stringify(outerEvidence, null, 2)}\n`, { flag: "wx" });
process.stdout.write(`${JSON.stringify({ ok: true, evidence: join(output, "evidence/outer-runner.json"), probes: probes.length })}\n`);
