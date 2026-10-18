import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { basename, sep } from "node:path";

const databaseName = path => ["OM0RX-xLog.sqlite", "OM0RX-xLog.sqlite-wal", "OM0RX-xLog.sqlite-shm"].includes(basename(path));
const inside = (path, root) => path === root || path.startsWith(`${root}${sep}`);

export function admitContestAcceptanceDatabaseFiles(paths, isolatedSupportRoot, protectedPaths) {
  const isolatedRoot = realpathSync(isolatedSupportRoot), protectedResolved = new Set(protectedPaths.map(path => {
    try { return realpathSync(path); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  }).filter(Boolean));
  const databases = [...new Set(paths.filter(databaseName).map(path => realpathSync(path)))].sort();
  assert.equal(databases.some(path => protectedResolved.has(path)), false, "The test host opened a protected normal database path.");
  const isolated = databases.filter(path => inside(path, isolatedRoot));
  assert.ok(isolated.some(path => basename(path) === "OM0RX-xLog.sqlite"), "The test host did not hold the isolated contest database open.");
  assert.equal(databases.length, isolated.length, "The test host opened a database outside its isolated support root.");
  return { isolatedRoot, databases };
}
