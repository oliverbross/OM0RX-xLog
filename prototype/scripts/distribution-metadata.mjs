// Build-time only: inventory actual resolved dependencies and carry their notices.
// This is evidence input, not a legal compliance certification or runtime program.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const destination = path.join(root, "prototype/distribution-metadata");
fs.mkdirSync(destination, { recursive: true });
const run = (command, args, cwd = root) => execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const components = [];
function notices(directory, key) {
  const copied = [];
  if (!fs.existsSync(directory)) return copied;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^(licen[cs]e|copying|notice|copyright)([-.]|$)/i.test(entry.name)) continue;
    const relative = path.join("notices", key.replace(/[^\w.-]/g, "_"), entry.name);
    fs.mkdirSync(path.dirname(path.join(destination, relative)), { recursive: true });
    const target = path.join(destination, relative);
    fs.copyFileSync(path.join(directory, entry.name), target);
    // Registry archives can carry owner-only modes; notices ship to other users.
    fs.chmodSync(target, 0o644);
    copied.push(relative.split(path.sep).join("/"));
  }
  return copied;
}
const npmLock = JSON.parse(fs.readFileSync(path.join(root, "prototype/package-lock.json"), "utf8"));
for (const [relative, value] of Object.entries(npmLock.packages)) {
  if (!relative || value.dev) continue;
  if (!relative.startsWith("node_modules/") || relative.split("/").includes("..")) throw Error("Unexpected npm lock path");
  const name = relative.split("node_modules/").at(-1);
  components.push({ ecosystem: "npm", name, version: value.version, license: value.license ?? "NOASSERTION",
    resolved: value.resolved, integrity: value.integrity, notices: notices(path.join(root, "prototype", relative), `npm-${name}-${value.version}`) });
}
const rustHost = run("rustc", ["-vV"]).match(/^host: (.+)$/m)?.[1];
if (!rustHost) throw Error("Rust host triple unavailable");
const cargo = JSON.parse(run("cargo", ["metadata", "--locked", "--format-version", "1", "--filter-platform", rustHost], path.join(root, "prototype/src-tauri")));
const resolved = new Set(cargo.resolve.nodes.map(node => node.id));
for (const value of cargo.packages) {
  if (!resolved.has(value.id)) continue;
  components.push({ ecosystem: "cargo", name: value.name, version: value.version, license: value.license ?? "NOASSERTION",
    source: value.source, notices: notices(path.dirname(value.manifest_path), `cargo-${value.name}-${value.version}`) });
}
fs.copyFileSync(path.join(root, "LICENSE"), path.join(destination, "XLOG-LICENSE"));
fs.copyFileSync(path.join(root, "prototype/package-lock.json"), path.join(destination, "package-lock.json"));
fs.copyFileSync(path.join(root, "prototype/src-tauri/Cargo.lock"), path.join(destination, "Cargo.lock"));
fs.writeFileSync(path.join(destination, "components.json"), JSON.stringify({ schema: 1,
  sourceCommit: run("git", ["rev-parse", "HEAD"]).trim(), rustHost,
  scope: "Resolved JavaScript runtime and Cargo target dependency inventory including build dependencies. Swift/OS dependencies are in the platform runtime manifest. Not a complete SPDX/CycloneDX SBOM or compliance certification.",
  components }, null, 2));
fs.writeFileSync(path.join(destination, "README.txt"), "OM0RX-xLog Prototype — synthetic data only. Not the stable macOS release.\nSource: https://github.com/oliverbross/OM0RX-xLog/tree/" + run("git", ["rev-parse", "HEAD"]).trim() + "\nNo radio, rotor, credentials, live logbook or Wavelog connection. Session QSOs clear on exit.\nComponents and notices are evidence inputs; final distribution licensing/signing review remains separate.\n");
console.log(`Distribution metadata: ${components.length} resolved components; ${destination}`);
