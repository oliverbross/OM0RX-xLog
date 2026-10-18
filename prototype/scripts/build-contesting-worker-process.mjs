#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}.`);
  return resolve(process.argv[index + 1]);
}
const scratchPath = option("--scratch-path");
const output = option("--output");
assert.equal(process.platform, "darwin", "This build manifest is macOS-specific.");
assert.ok(!existsSync(scratchPath), "A fresh worker build requires a new scratch path.");
assert.ok(!existsSync(output), "Build manifest output must be a new path.");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });
  const rendered = `${command} ${args.join(" ")}`;
  if (result.error) throw new Error(`${rendered} could not start: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) {
    const outcome = result.signal ? `signal ${result.signal}` : `exit ${result.status ?? "unknown"}`;
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(`${rendered} failed (${outcome})${stderr ? `:\n${stderr}` : "."}`);
  }
  return typeof result.stdout === "string" ? result.stdout.trim() : "";
}
function hashFile(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
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

const head = run("git", ["rev-parse", "HEAD"]);
const compiledDiff = run("git", ["status", "--porcelain=v1", "--", "Package.swift", "Sources", "Tests"]);
assert.equal(compiledDiff, "", `Compiled inputs differ from ${head}:\n${compiledDiff}`);
// Invoke the driver path returned by xcrun. Resolving its symlink can produce
// swift-frontend, which does not accept SwiftPM's build arguments.
const swiftPath = run("/usr/bin/xcrun", ["--find", "swift"]);
const swiftVersion = run(swiftPath, ["--version"]);
const buildArguments = [
  "build", "--build-system", "xcode", "-j", "2", "--scratch-path", scratchPath,
  "-c", "release", "--product", "xlog-prototype-worker",
];
const buildEnvironment = { ...process.env, XLOG_PORTABLE_ONLY: "1" };
run(swiftPath, buildArguments, { env: buildEnvironment, stdio: ["ignore", "inherit", "inherit"] });
const binDirectory = run(swiftPath, [
  "build", "--build-system", "xcode", "-j", "2", "--scratch-path", scratchPath,
  "-c", "release", "--show-bin-path",
], { env: buildEnvironment });
const workerPath = join(binDirectory, "xlog-prototype-worker");
const resourcePaths = {
  logbook: join(binDirectory, "OM0RXXLogPrototype_XLogCore.bundle"),
  contest: join(binDirectory, "OM0RXXLogPrototype_XContestCore.bundle"),
};
assert.ok(statSync(workerPath).isFile(), "Fresh worker binary is missing.");
for (const [kind, path] of Object.entries(resourcePaths)) {
  assert.ok(statSync(path).isDirectory(), `Fresh ${kind} worker resource bundle is missing.`);
}
const headAfterBuild = run("git", ["rev-parse", "HEAD"]);
const compiledDiffAfterBuild = run("git", ["status", "--porcelain=v1", "--", "Package.swift", "Sources", "Tests"]);
assert.equal(headAfterBuild, head, "Source HEAD changed while the worker was building.");
assert.equal(compiledDiffAfterBuild, "", `Compiled inputs changed while the worker was building:\n${compiledDiffAfterBuild}`);
const resources = Object.fromEntries(Object.entries(resourcePaths).map(([kind, path]) => [
  kind, { path, ...resourceManifest(path) },
]));
const manifest = {
  schemaVersion: 2,
  sourceHead: head,
  sourceHeadAfterBuild: headAfterBuild,
  compiledInputsClean: true,
  toolchain: { swiftPath, swiftVersion },
  build: {
    cwd: root,
    environment: { XLOG_PORTABLE_ONLY: "1" },
    command: [swiftPath, ...buildArguments],
    showBinPathCommand: [swiftPath, "build", "--build-system", "xcode", "-j", "2", "--scratch-path", scratchPath, "-c", "release", "--show-bin-path"],
    scratchPath,
  },
  worker: { path: workerPath, size: statSync(workerPath).size, sha256: hashFile(workerPath) },
  resources,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ ok: true, manifest: output, sourceHead: head, workerSha256: manifest.worker.sha256,
  resourcesSha256: Object.fromEntries(Object.entries(resources).map(([kind, value]) => [kind, value.treeSha256])) }));
