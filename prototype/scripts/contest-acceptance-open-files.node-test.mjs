import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { closeSync, mkdtempSync, mkdirSync, openSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { admitContestAcceptanceDatabaseFiles } from "./contest-acceptance-open-files.mjs";

const fixture = () => { const root = mkdtempSync(join(tmpdir(), "xlog-open-files-")), isolated = join(root, "isolated"), contestRoot = join(isolated, "Contesting"), protectedRoot = join(root, "protected");
  mkdirSync(contestRoot, { recursive: true }); mkdirSync(protectedRoot); const isolatedDB = join(isolated, "OM0RX-xLog.sqlite"), contestDB = join(contestRoot, "contests.sqlite"), protectedDB = join(protectedRoot, "OM0RX-xLog.sqlite");
  writeFileSync(isolatedDB, "isolated"); writeFileSync(contestDB, "contest"); writeFileSync(protectedDB, "protected"); return { root, isolated, isolatedDB, contestDB, protectedDB }; };

test("admits only the resolved isolated contest database", () => { const value = fixture();
  const result = admitContestAcceptanceDatabaseFiles([value.isolatedDB], value.isolated, [value.protectedDB]);
  assert.equal(result.isolatedRoot, realpathSync(value.isolated));
  assert.deepEqual(result.databases, [realpathSync(value.isolatedDB)]);
});

test("requires the isolated workspace primary database", () => { const value = fixture();
  assert.throws(() => admitContestAcceptanceDatabaseFiles([], value.isolated, [value.protectedDB]),
    /did not hold the isolated workspace database open/);
});

test("requires the isolated contest store when requested", () => { const value = fixture();
  assert.throws(() => admitContestAcceptanceDatabaseFiles([value.isolatedDB], value.isolated, [value.protectedDB],
    { requireWorkspace: true, requireContest: true }), /did not hold the isolated contest store open/);
});

test("admits two PID-bounded lsof checkpoints while both isolated databases remain open", () => {
  const value = fixture(), descriptors = [openSync(value.isolatedDB, "r"), openSync(value.contestDB, "r")];
  try {
    const observations = ["after-workspace-ready", "before-exit"].map(phase => {
      const output = execFileSync("/usr/sbin/lsof", ["-Fn", "-p", String(process.pid)],
        { encoding: "utf8", maxBuffer: 4_000_000, timeout: 5_000 });
      const paths = output.split("\n").filter(row => row.startsWith("n/")).map(row => row.slice(1));
      return { phase, ...admitContestAcceptanceDatabaseFiles(paths, value.isolated, [value.protectedDB],
        { requireWorkspace: true, requireContest: true }) };
    });
    assert.deepEqual(observations.map(value => value.phase), ["after-workspace-ready", "before-exit"]);
    const resolvedDatabase = realpathSync(value.isolatedDB);
    const resolvedContest = realpathSync(value.contestDB);
    assert.deepEqual(observations.map(value => value.databases),
      [[resolvedDatabase, resolvedContest].sort(), [resolvedDatabase, resolvedContest].sort()]);
  } finally { for (const descriptor of descriptors) closeSync(descriptor); }
});

test("rejects protected, prefix-sibling, traversal and symlink escapes", () => { const value = fixture(), sibling = `${value.isolated}-other`;
  mkdirSync(sibling); const siblingDB = join(sibling, "OM0RX-xLog.sqlite"); writeFileSync(siblingDB, "sibling");
  const outsideContest = join(value.root, "contests.sqlite"); writeFileSync(outsideContest, "outside contest");
  const alias = join(value.isolated, "alias"); mkdirSync(alias); const link = join(alias, "OM0RX-xLog.sqlite"); symlinkSync(value.protectedDB, link);
  const innocentAlias = join(value.isolated, "ordinary-file"); symlinkSync(value.protectedDB, innocentAlias);
  for (const escaped of [value.protectedDB, siblingDB, outsideContest, join(value.isolated, "..", "protected", "OM0RX-xLog.sqlite"), link, innocentAlias])
    assert.throws(() => admitContestAcceptanceDatabaseFiles([value.isolatedDB, escaped], value.isolated, [value.protectedDB]));
  assert.deepEqual(admitContestAcceptanceDatabaseFiles([value.isolatedDB, join(value.root, "missing-unrelated")], value.isolated,
    [value.protectedDB]).databases, [realpathSync(value.isolatedDB)]);
  assert.throws(() => admitContestAcceptanceDatabaseFiles([value.isolatedDB, join(value.root, "contests.sqlite-wal")], value.isolated,
    [value.protectedDB]));
});
