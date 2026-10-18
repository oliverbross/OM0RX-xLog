#!/usr/bin/env node
import assert from "node:assert/strict";
import { runBoundedChild } from "./bounded-child-process.mjs";

let deadline;
try {
  await runBoundedChild(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    { timeoutMs: 500, terminateGraceMs: 100 });
  assert.fail("Hung child unexpectedly completed.");
} catch (error) {
  assert.equal(error.code, "deadline_exceeded");
  assert.equal(error.signal, "SIGKILL");
  assert.ok(Number.isInteger(error.pid));
  assert.throws(() => process.kill(error.pid, 0), value => value?.code === "ESRCH");
  deadline = { code: error.code, signal: error.signal, reapedPID: error.pid };
}
let spawnFailure;
try { await runBoundedChild("/definitely/missing/xlog-child", []); }
catch (error) { assert.equal(error.code, "spawn_failed"); spawnFailure = error.code; }
assert.equal(spawnFailure, "spawn_failed");

let readinessDeadline;
const readinessStartedAt = Date.now();
try {
  await runBoundedChild(process.execPath,
    ["-e", "setTimeout(()=>process.stderr.write('READY\\n'),250);process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],
    { startupTimeoutMs: 1_000, readinessSignal: "READY", timeoutMs: 150, terminateGraceMs: 50 });
  assert.fail("Ready hung child unexpectedly completed.");
} catch (error) {
  assert.equal(error.code, "deadline_exceeded");
  assert.equal(error.readinessObserved, true);
  assert.ok(Date.now() - readinessStartedAt >= 350, "Stall deadline started before readiness.");
  readinessDeadline = { code: error.code, readinessObserved: error.readinessObserved };
}

let processGroupDeadline;
const groupProgram = `
  const { spawn } = require("node:child_process");
  spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
`;
try {
  await runBoundedChild(process.execPath, ["-e", groupProgram],
    { timeoutMs: 700, terminateGraceMs: 100, processGroup: true });
  assert.fail("Hung process group unexpectedly completed.");
} catch (error) {
  assert.equal(error.code, "deadline_exceeded");
  assert.equal(error.processGroup, true);
  assert.ok(error.ownedPIDs.length >= 2, "Expected parent and grandchild in the owned process group.");
  assert.deepEqual(error.lingeringPIDs, []);
  for (const pid of error.ownedPIDs) assert.throws(() => process.kill(pid, 0), value => value?.code === "ESRCH");
  processGroupDeadline = { code: error.code, signal: error.signal, reapedPIDs: error.ownedPIDs };
}
process.stdout.write(`${JSON.stringify({ ok: true, deadline, readinessDeadline, processGroupDeadline, spawnFailure })}\n`);
