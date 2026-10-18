import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { basename, sep } from "node:path";

const workspaceNames = new Set(["OM0RX-xLog.sqlite", "OM0RX-xLog.sqlite-wal", "OM0RX-xLog.sqlite-shm"]);
const contestNames = new Set(["contests.sqlite", "contests.sqlite-wal", "contests.sqlite-shm"]);
const databaseName = path => workspaceNames.has(basename(path)) || contestNames.has(basename(path));
const inside = (path, root) => path === root || path.startsWith(`${root}${sep}`);

export function admitContestAcceptanceDatabaseFiles(paths, isolatedSupportRoot, protectedPaths,
                                                     { requireWorkspace = true, requireContest = false } = {}) {
  const isolatedRoot = realpathSync(isolatedSupportRoot), protectedResolved = new Set(protectedPaths.map(path => {
    try { return realpathSync(path); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  }).filter(Boolean));
  const databases = [...new Set(paths.flatMap(path => {
    const rawCandidate = databaseName(path);
    try {
      const resolved = realpathSync(path);
      return rawCandidate || databaseName(resolved) ? [resolved] : [];
    } catch (error) {
      if (error?.code === "ENOENT" && !rawCandidate) return [];
      throw error;
    }
  }))].sort();
  assert.equal(databases.some(path => protectedResolved.has(path)), false, "The test host opened a protected normal database path.");
  const isolated = databases.filter(path => inside(path, isolatedRoot));
  const workspaceDatabases = isolated.filter(path => workspaceNames.has(basename(path)));
  const contestDatabases = isolated.filter(path => contestNames.has(basename(path)));
  if (requireWorkspace) assert.ok(workspaceDatabases.some(path => basename(path) === "OM0RX-xLog.sqlite"),
    "The test host did not hold the isolated workspace database open.");
  if (requireContest) assert.ok(contestDatabases.some(path => basename(path) === "contests.sqlite"),
    "The test host did not hold the isolated contest store open.");
  assert.equal(databases.length, isolated.length, "The test host opened a database outside its isolated support root.");
  return { isolatedRoot, databases, workspaceDatabases, contestDatabases };
}
