import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helper = join(dirname(fileURLToPath(import.meta.url)), "verify-relocated-contest-resources.mjs");
const contestBundle = "OM0RXXLogPrototype_XContestCore.bundle";
const logbookBundle = "OM0RXXLogPrototype_XLogCore.bundle";

function fixture(mode) {
  const root = mkdtempSync(join(tmpdir(), "xlog-relocation-helper-"));
  const bin = join(root, "bin"), output = join(root, "proof");
  mkdirSync(join(bin, contestBundle), { recursive: true });
  mkdirSync(join(bin, logbookBundle), { recursive: true });
  const executable = join(bin, "xlog-prototype-worker");
  const behavior = mode === "malformed"
    ? 'process.stdin.once("data",()=>process.stdout.write("{bad\\n"));'
    : mode === "extra-frame"
      ? 'process.stdin.once("data",()=>process.stdout.write("{\\"id\\":\\"workspace_create-1\\",\\"ok\\":true,\\"result\\":{}}\\n{\\"id\\":\\"extra\\",\\"ok\\":true,\\"result\\":{}}\\n"));'
    : "process.stdin.resume();";
  writeFileSync(executable, `#!${process.execPath}\n${behavior}\nsetInterval(()=>{},1000);\n`);
  chmodSync(executable, 0o755);
  return { root, bin, output, original: join(bin, contestBundle) };
}

function assertRestored(value) {
  assert.ok(existsSync(value.original), "Original contest bundle was not restored.");
  assert.deepEqual(readdirSync(value.bin).filter(name => name.includes(".relocation-proof-")), []);
  assert.ok(existsSync(join(value.output, "relocation-failure.json")), "Failure evidence was removed.");
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

test("malformed worker frames reject the request, reap the worker, and restore resources", () => {
  const value = fixture("malformed");
  try {
    const result = spawnSync(process.execPath, [helper, "--bin-directory", value.bin, "--output", value.output],
      { encoding: "utf8", timeout: 10_000 });
    assert.notEqual(result.status, 0, result.stdout);
    assert.equal(result.signal, null);
    assertRestored(value);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("an extra frame after a valid response is latched and cannot produce success", () => {
  const value = fixture("extra-frame");
  try {
    const result = spawnSync(process.execPath, [helper, "--bin-directory", value.bin, "--output", value.output],
      { encoding: "utf8", timeout: 10_000 });
    assert.notEqual(result.status, 0, result.stdout);
    assert.equal(existsSync(join(value.output, "relocation-proof.json")), false);
    assertRestored(value);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test("SIGTERM cancellation reaps the worker and restores resources", async () => {
  const value = fixture("waiting");
  try {
    const proof = spawn(process.execPath, [helper, "--bin-directory", value.bin, "--output", value.output],
      { stdio: ["ignore", "pipe", "pipe"] });
    const deadline = Date.now() + 5_000;
    while (existsSync(value.original) && Date.now() < deadline) {
      await new Promise(resolveWait => setTimeout(resolveWait, 10));
    }
    assert.equal(existsSync(value.original), false, "Helper did not hide the original bundle.");
    proof.kill("SIGTERM");
    const exit = await within(
      new Promise(resolveExit => proof.once("close", (code, signal) => resolveExit({ code, signal }))),
      10_000, "Cancelled helper did not exit.");
    assert.notEqual(exit.code, 0);
    assertRestored(value);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});
