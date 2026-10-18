# Canonical main consolidation inventory — 2026-10-18

Snapshot time: `2026-10-18T05:38:33Z` (`2026-10-18T15:08:33+0930`). This is a read-only consolidation audit. No worktree was pruned, removed, reset, cleaned, committed, or switched during the audit. The canonical checkout remains clean on pushed `codex/contest-cqww-feedback-build` at `fa53447b4e7a32461e752e3595cbc298f3ba40be`.

## Accepted non-contest ancestry

`origin/main` and local `main` are `c5059ea5798edc6e3094e3d204fd9270de34916f`. The accepted application source `a2b959da84796babf6b3158a34071e121203ba28` is 69 commits ahead, its receipt `5459ab196dbc7aa580c12677d19ba1b2b2f0420d` is 70 commits ahead, `fbb5eb7` is 71 commits ahead, and accepted `b9accc7f81453f1f2cab1758a48192322213f590` is 72 commits ahead. Each earlier point is an ancestor of the next. The exact 70-commit `origin/main..5459ab1` list is retained at `/tmp/xlog-main-70.log` with SHA-256 `de1e567a778bd5351d6c43a863987ad79324f7016bc958bd5f99be943671a10b`.

The two commits after `5459ab1` are management-only:

- `fbb5eb7` — `PROJECT_STATUS.md`, 103 insertions and 5 deletions.
- `b9accc7` — `PROJECT_STATUS.md`, 4 insertions and 3 deletions.

## Registered worktrees

The `b9ac` comparison is `b9ac-only / worktree-only`. “Remote” is the exact same-name remote branch observed with `git ls-remote`; WIP is reported separately from commit reachability.

| Worktree | Branch / HEAD | vs `b9ac` | Same-name remote | Worktree state |
| --- | --- | ---: | --- | --- |
| `/Users/oliver/Documents/Projects/OM0RX-xLog` | `codex/contest-cqww-feedback-build` / `fa53447` | `2 / 305` | exact `fa53447` | clean |
| `/Users/oliver/.codex/worktrees/contest-corrections/OM0RX-xLog` | `codex/contest-corrections` / `46ee0c3` | `63 / 60` | exact `46ee0c3` | clean |
| `/Users/oliver/.codex/worktrees/contest-cqww-integration/OM0RX-xLog` | `codex/contest-cqww-feedback-integration` / `fa53447` | `2 / 305` | exact `fa53447` | clean before this evidence file |
| `/Users/oliver/.codex/worktrees/contest-exports/OM0RX-xLog` | `codex/contest-json-acceptance-composition` / `515163a` | `8 / 303` | no same-name remote; HEAD is reachable from `origin/codex/contest-json-resource-catalog` | **30 staged files**, no unstaged or untracked files |
| `/Users/oliver/.codex/worktrees/contest-portability/OM0RX-xLog` | `codex/contest-sst-worker-acceptance` / `aaf8033` | `8 / 296` | no same-name remote; HEAD is remotely reachable | **3 unstaged and 3 untracked files** |
| `/Users/oliver/.codex/worktrees/contest-ssb/OM0RX-xLog` | `codex/contest-expanded-operator-acceptance` / `4be39ca` | `8 / 297` | exact `4be39ca` at audit time | clean |
| `/Users/oliver/.codex/worktrees/contest-windows-runtime/OM0RX-xLog` | `codex/contest-arrl-dx-ledger` / `c342808` | `63 / 220` | exact `c342808` | clean |
| `/Users/oliver/.codex/worktrees/xlog-contesting/OM0RX-xLog` | `codex/contest-review-checkpoint` / `e477a02` | `15 / 286` | exact `e477a02` | clean |
| `/Users/oliver/Documents/Projects/OM0RX-xLog-beta3-resume` | `main` / `c5059ea` | `72 / 0` | `origin/main` exact | path missing; registered as prunable |
| `/Users/oliver/Documents/Projects/OM0RX-xLog-settings-safety` | `codex/settings-session-safety` / `29150b7` | `592 / 0` | no same-name remote; HEAD is remotely reachable | **2 unstaged and 1 untracked file** |

Dirty-state preservation coordinates:

- `contest-exports`: staged binary diff SHA-256 `fdfbd688c7994827ba58d26f35c9a0619f1d5bca3f25bf32ebff32faa81458fc`; 30 files, 1,357 insertions, 167 deletions. Unstaged diff is empty and there are no untracked files.
- `contest-portability`: unstaged binary diff SHA-256 `37f02c34c7970228bef1a5dd4612c66193480c308ea24326b51581b43a251833`; 3 files, 11 insertions, 6 deletions. Untracked SHA-256 values: `ContestSSTWorkerAcceptanceTests.swift` `b6dcfb37b90194ae2647fa6d8f4c9a1ed9e7197fa38df58b0eba2e77693a898c`, `sst-worker-acceptance-wire.json` `8d46b4fa414773dee01d97d3925e5d3adad31e6a4c6db4e77a309b3ef92e7248`, and `sstWorkerAcceptanceWireFixture.test.tsx` `656183af3fd150b4a468b45c9e93ae5543bd5215ab205aa2a86b5a54cd231893`.
- `settings-safety`: unstaged binary diff SHA-256 `d5dc380f410c3bb91c2d4645643abf7a1a0641c003223bbbbb429a2399b1b77b`; 2 files, 238 insertions. Untracked `SettingsDatabaseTests.swift` SHA-256 `a435c522324d5a6dfe6b7d00936d0566d9b6d556f58007b31e388109be37ab22`.

No registered worktree has an unpushed commit relative to its configured upstream. Branches without upstreams are `codex/contest-arrl-rtty-exports`, `codex/contest-definition-runtime-catalog`, `codex/contest-eleven-rule-ledger`, `codex/contest-json-acceptance-composition`, `codex/contest-pinned-plugin-converter`, `codex/contest-sst-operator-source-integration`, `codex/contest-sst-worker-acceptance`, `codex/contest-station-serial-policy`, `codex/macos-alpha30-recovery`, and `codex/settings-session-safety`. All are reachable from at least one pushed remote ref except `codex/macos-alpha30-recovery` at `0e6304ff179e83b4b5007f89461752e38ce66788`, which has one commit not reachable from any remote. That commit changes six packaging/version files for the historical alpha.30 recovery build and must be pushed or otherwise preserved before any branch cleanup.

## Stale `main` worktree registration

The registered path `/Users/oliver/Documents/Projects/OM0RX-xLog-beta3-resume` does not exist. Git marks it prunable. Its untouched admin directory is `.git/worktrees/OM0RX-xLog-beta3-resume`; `gitdir` still points at the missing path and `HEAD` points at `refs/heads/main`. The admin index SHA-256 is `4f9fae2d56391f89c86e29e834bba089593b477b25282b083675dcfa1561d8af`. Its written tree is `14a032aba610871b7921c0d03b89f858a76f4e28`, exactly the tree of `c5059ea`; the stale index therefore contains no staged delta. No prune or metadata edit was performed.

Before the approved prune, the complete admin directory was archived at `/tmp/xlog-main-consolidation-evidence-2026-10-18/OM0RX-xLog-beta3-resume-git-admin.tar.gz` (60,435 bytes), SHA-256 `af786c5aea03695dd41cc82035c99eb86071047326f8895fe271f033257c7aea`.

## Diagnostic package held from installation

The canonical-only `fa53447` diagnostic package completed successfully at `/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog Contesting Test.app`. It was not installed or launched. Deep strict code-sign verification passes. Its identifier is `com.oliverbross.xlog.contesting-test`, display name is `OM0RX-xLog Contesting Test`, and its only URL scheme is `om0rx-xlog-contesting-test`.

- App executable SHA-256: `2bb97be876d130ea76b1d36585d79281eefc04bf1e403f3f03cda8c7b3b2c698`.
- Worker SHA-256: `dbc8764eb45537eea14fb4ebbf316431285f6adb9bcf836549055af9e954c916`.
- `Info.plist` SHA-256: `3e60777b76e1dcfde56220057f50182898f54341a0de72b0622ca9fe6f963453`.
- Package log: `/tmp/xlog-cqww-package-evidence/package-final.log`, SHA-256 `11f7935f21f5da311c050931f8dd8a29761b8ababd93ddcd61cad0b9d7dc108f`.
- The protected-file stat manifest remained byte-identical before and after the build: SHA-256 `19b225d6ab9af4868d52e7c83e8d89c7ffafbaba85fd2424a2a297d5a67f0539`.

## Proposed non-contest `main` consolidation

Run only after review and after confirming no branch/worktree changed since this snapshot:

```sh
cd /Users/oliver/Documents/Projects/OM0RX-xLog
git fetch origin
git status --short --branch
git worktree list --porcelain

# Preserve the old main tip and the only local-only commit before metadata cleanup.
git branch codex/main-pre-consolidation-c5059 c5059ea5798edc6e3094e3d204fd9270de34916f
git push --set-upstream origin codex/main-pre-consolidation-c5059
git push --set-upstream origin codex/macos-alpha30-recovery:codex/macos-alpha30-recovery

# The dry run must name only OM0RX-xLog-beta3-resume.
git worktree prune --dry-run --expire now
git worktree prune --expire now --verbose

git switch main
git pull --ff-only origin main
git merge --ff-only b9accc7f81453f1f2cab1758a48192322213f590
test "$(git rev-parse HEAD)" = b9accc7f81453f1f2cab1758a48192322213f590

# The original full-suite proposal was superseded by the reviewed bounded baseline:
# 22 focused UI tests, 10 focused Swift filters, 6 focused Rust modules,
# and the production frontend build. Results are pending from the baseline owner.

git push origin main
git rev-list --left-right --count main...origin/main  # must print: 0  0
```

## Approved consolidation execution checkpoint

The approved preservation and local fast-forward completed after a refreshed clean-state and remote audit:

- `codex/main-pre-consolidation-c5059` was created at `c5059ea5798edc6e3094e3d204fd9270de34916f` and pushed to the matching remote branch.
- `codex/macos-alpha30-recovery` at `0e6304ff179e83b4b5007f89461752e38ce66788` was pushed to the matching remote branch.
- The stale worktree dry run produced exactly one entry, `OM0RX-xLog-beta3-resume`. Its archived admin metadata is recorded above, and only that stale registration was pruned.
- The canonical checkout was switched to `main`, updated from `origin/main`, and fast-forwarded locally to exact `b9accc7f81453f1f2cab1758a48192322213f590`. It is clean and `72 / 0` relative to the still-unmodified `origin/main` while the approved baseline runs.
- The generated root `node_modules` directory was preserved in place. The accepted ancestry adds its ignore rule in the first fast-forwarded commit, so it is neither removed nor absorbed.
- The three dirty worktrees retain their exact pre-operation status and content hashes. All nine real worktrees remain registered.

No baseline test, `main` push, contest composition, package installation, or app launch is part of this checkpoint.

The dirty `contest-exports`, `contest-portability`, and `settings-safety` worktrees must remain untouched. Before `git push origin main`, a failed baseline can be rolled back locally to the pushed preservation anchor with `git reset --hard codex/main-pre-consolidation-c5059` only after re-verifying the canonical checkout has no user changes. After the main push, do not force-reset the shared branch; use a reviewed corrective commit. After the non-contest main push, contest integration should be composed on a new reviewed branch from `b9accc7`; the held `fa53447` package must remain labeled as a diagnostic built from the pre-consolidation source.
