import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, mkdirSync, openSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { admitContestAcceptanceDatabaseFiles } from "./contest-acceptance-open-files.mjs";

const fixture = () => { const root = mkdtempSync(join(tmpdir(), "xlog-open-files-")), isolated = join(root, "isolated"), protectedRoot = join(root, "protected");
  mkdirSync(isolated); mkdirSync(protectedRoot); const isolatedDB = join(isolated, "OM0RX-xLog.sqlite"), protectedDB = join(protectedRoot, "OM0RX-xLog.sqlite");
  writeFileSync(isolatedDB, "isolated"); writeFileSync(protectedDB, "protected"); return { root, isolated, isolatedDB, protectedDB }; };

test("admits only the resolved isolated contest database", () => { const value = fixture();
  const result = admitContestAcceptanceDatabaseFiles([value.isolatedDB], value.isolated, [value.protectedDB]);
  assert.equal(result.isolatedRoot, realpathSync(value.isolated));
  assert.deepEqual(result.databases, [realpathSync(value.isolatedDB)]);
});

test("requires the isolated primary database", () => { const value = fixture();
  assert.throws(() => admitContestAcceptanceDatabaseFiles([], value.isolated, [value.protectedDB]),
    /did not hold the isolated contest database open/);
});

test("admits two PID-bounded lsof checkpoints while the isolated database remains open", () => {
  const value = fixture(), descriptor = openSync(value.isolatedDB, "r");
  try {
    const observations = ["after-workspace-ready", "before-exit"].map(phase => {
      const output = execFileSync("/usr/sbin/lsof", ["-Fn", "-p", String(process.pid)],
        { encoding: "utf8", maxBuffer: 4_000_000, timeout: 5_000 });
      const paths = output.split("\n").filter(row => row.startsWith("n/")).map(row => row.slice(1));
      return { phase, ...admitContestAcceptanceDatabaseFiles(paths, value.isolated, [value.protectedDB]) };
    });
    assert.deepEqual(observations.map(value => value.phase), ["after-workspace-ready", "before-exit"]);
    const resolvedDatabase = realpathSync(value.isolatedDB);
    assert.deepEqual(observations.map(value => value.databases), [[resolvedDatabase], [resolvedDatabase]]);
  } finally { closeSync(descriptor); }
});

test("rejects protected, prefix-sibling, traversal and symlink escapes", () => { const value = fixture(), sibling = `${value.isolated}-other`;
  mkdirSync(sibling); const siblingDB = join(sibling, "OM0RX-xLog.sqlite"); writeFileSync(siblingDB, "sibling");
  const alias = join(value.isolated, "alias"); mkdirSync(alias); const link = join(alias, "OM0RX-xLog.sqlite"); symlinkSync(value.protectedDB, link);
  for (const escaped of [value.protectedDB, siblingDB, join(value.isolated, "..", "protected", "OM0RX-xLog.sqlite"), link])
    assert.throws(() => admitContestAcceptanceDatabaseFiles([value.isolatedDB, escaped], value.isolated, [value.protectedDB]));
});
