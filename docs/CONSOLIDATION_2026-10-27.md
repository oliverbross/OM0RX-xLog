# Canonical consolidation and safe cleanup — 27 October 2026

The accepted implementation was already consolidated into canonical `main`.
This operation preserved unfinished source, established the planning entry point,
reverified the actual signed application, ran fresh integrated checks and removed
verified disposable paths. It did not start the N1MM Next Level roadmap.

## Source reconciliation and coordination

The initial canonical/main and origin/main SHA was
`03cf98ef78675901cf1ca96c0ddfb4190b6538a9`. Fetch and fast-forward-only pull
completed; the checkout was clean before work. GitHub returned no open PRs or
issues. Local and remote branch heads agreed: main, `codex/cw-skimmer` at
`3a28134caa6c6c981c5f2a564fa22a69d1bc7778`, and
`codex/cluster-classic-appearance` at
`3fae3c4e0b87f46337f98f81d25e99375076317c`.

The chat inventory and latest handoffs for “Complete contest readiness and fixes”,
“Fix cluster spots and clean versions”, “Implement the full change”, and
“Find cluster display setting” showed completed turns and released live/CPU holds.
The recorder handoff was also inspected. A fresh inventory before cleanup found
this consolidation to be the only active xLog chat. No other task was awakened
to resume implementation, and no shared app/UI ownership was taken.

The Classic branch contains one non-ancestor patch; `git cherry main` reports
that patch already applied. Its accepted equivalent is `28f69e5d`, included in
1.3.36. Reapplying it would duplicate work. Later main changes after application
source `07957050` affect release documentation only. No accepted application-code
patch was missing, so no merge, cherry-pick, version bump or replacement build
was necessary. Main's completed commits were already pushed.

CW's later branch contains substantial unfinished implementation and failed
qualification, including the strict 32-track capacity test. It was not merged
or enabled. Its pushed branch, local worktree and dependency symlink remain.
The retired settings stash is an unaccepted experiment whose remaining semantic
differences must be compared with the newer canonical transactional settings
owner; it was not applied over that owner.

## Application identity and wiring

The application remains **1.3.36**, exact source
`079570505b06f0a5aba403aa6105909148652c91`. Existing release provenance includes
the signed native host, universal Swift worker, bundled Python 3.12.4 host/vendor,
native CW worker/model/runtime and distribution/source notices. The application
executable is arm64; Intel-app execution and notarization are not claimed.

| Retained role | Exact path |
| --- | --- |
| Current installed application | `/Applications/OM0RX-xLog.app` |
| Verified known-good rollback | `/Users/oliver/Documents/Projects/OM0RX-xLog/.build/releases/1.3.36/OM0RX-xLog.app` |
| Canonical staged signed bundle | `/Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app` |

All three pass fresh deep/strict Developer ID and Hardened Runtime checks for
team `4WCMQ4U946`. Their **4,075 entries** agree, including file contents,
permission modes and symlink targets. Eight critical component hashes match the
installed release receipt. **171 bundled Python source files** match their Git
objects at the exact application SHA. Distribution, Python and CW provenance
agree; CW experimental/fixture flags are both false. Canonical source has no
application-code difference from that SHA.

A fresh production frontend build also found all **174 content-hashed asset
names** in the signed native executable's embedded inventory. This checks that
the current frontend graph is present, alongside the release's exact-source and
signature evidence; it is not an independent decompression/reconstruction of
every embedded payload byte.

Accepted behavior includes all-contest host integration/scoped analytics,
sync-run and committed-local-change journals, recorder playback, explicit Log
Review callsign correction/search, two-radio settings, contest timing, queued
workspace switching with deferred cosmetic spot retirement, Cluster Show Yes/No,
map/band-map/propagation fixes and the shared Classic/Modern appearance setting.
Their earlier source, browser and installed receipts retain their individual
scope; current full frontend/native tests and exact bundled worker/Python checks
verify the production owners and packaged resources. Merely being in Git is not
used as proof of installed behavior. See the
[1.3.36 release](MACOS_1_3_36_RELEASE_2026-10-26.md),
[readiness matrix](contesting/ALL_CONTESTS_READINESS.md) and
[cluster delivery](CLUSTER_MAPS_CLEANUP_ACCEPTANCE_2026-10-26.md).

No installed-app replacement was needed. The running app and worker were left
alone; no Quit, restart, draft clearing, recording stop/start, playback or station
action was performed. No production-log edit/rescore, manual sync or new upload
was invoked. Existing autonomous app activity is not claimed to be frozen.

## Fresh verification

All checks use the canonical source and existing disposable fixtures. Commands,
numeric exits and log hashes are in the
[machine-readable receipt](planning/CONSOLIDATION_2026-10-27_RECEIPT.json).

| Gate | Fresh result |
| --- | --- |
| `npm test` | Two Node tests and **4,529 Vitest tests / 307 files passed**; no failures. |
| Full Python discovery | **408 passed**, no skips/errors/failures. |
| Locked Rust suite | **889 unit + 26 integration cases passed**, no failures/ignored cases. Dummy-daemon opt-in is not physical radio acceptance. |
| Full portable Swift XCTest run | All seven test bundles passed; six intentional opt-in/platform cases skipped, reasons retained in the receipt. Includes actual all-94 native/Python lifecycle checks. |
| Standard Swift core CI gate | `swift test --scratch-path .build/consolidation-core-tests` passed, including the shared core Swift Testing suites; per-run counts retained in the receipt. No legacy app was packaged. |
| Production frontend build | TypeScript, Vite and **24 window graphs** passed. Existing large-chunk warning remains informational. |
| Exact signed packaged Swift worker | **8 process cases passed**, including fresh/expired retained spot receipts, retirement, bounded framing and external-service refusal in isolated storage. |
| Exact packaged Python runtime/host/vendor | **44 CQ WW SSB positive-control/all-catalogue analytics cases passed**; imported owners match Git; disposable storage removed. |
| App provenance after cleanup | All retained bundles rechecked against exact release hashes/source/signatures. |
| Repository/document checks | Intended files only; whitespace, source-ref/link inventory and origin/main agreement checked before closeout. |

The old broad frontend failures remain historical in their original report.
This fresh all-green run is separately attributable to the already corrected
canonical source, not a rewrite of those earlier results. Suite counts overlap
and are not added into one inflated coverage number.

## Recovery and unfinished work

The [master plan](planning/00_N1MM_NEXT_LEVEL_MASTER_PLAN.md) has **33 stable
work-owner rows**, each with status, priority, source, dependencies and completion
criteria. Its child register retains **643 distinct historical markers from
834 source occurrences across 208 documents**, with source line/commit and
deduplicated owner mappings. Historical markers are explicitly reconciliation
work; they are not represented as 643 confirmed current defects. The 94-row
matrix and CW branch gate documents retain their finer-grained acceptance limits.

Every original stash remains. **Nine stable recovery refs** preserve all seven
stashes plus CW and Classic tips, including stash third-parent untracked source,
tests and review images/scripts. `git bundle verify`, named-ref checks and a
SHA-256 digest verify the independent private backup:

`/Users/oliver/Documents/Backups/OM0RX-xLog/Consolidation-20261027/all-source-and-stashes.bundle`

Size: **49,181,199 bytes**. SHA-256:
`ccb4db92a6e8593cd017fc47fb736d2618c43b7a39c42255466581bb92fe9e02`.
The directory is 700, bundle/receipt are 600; raw fresh logs and verification
scripts/receipts are also retained there privately. This is a Git-source backup,
not a new live-database snapshot. No production backup was needed for an app
replacement because no replacement occurred.

The existing protected five-root pre-install data backup remains at
`/Users/oliver/Documents/Backups/OM0RX-xLog/Mode-fix-1.3.36-before-install-20261026T230936+0930`.
Its historic 35-database/byte-integrity acceptance is preserved; it was not
restored over newer user state or described as a fresh snapshot of today's data.

Open limitations include CQWS federal-unit scoring, AADX history, finite/candidate
Needed contexts, CW capacity/hardware/corpus/recovery/soak qualification, recorder
input/routing coverage, physical output/rotor/digital-engine acceptance,
provider/remote-backup gates and current platform/notarization acceptance.
Existing restrictions remain intentional. None blocks identifying the accepted
1.3.36 baseline; they remain blockers to the corresponding expanded claim.

## Applied cleanup

Before mutation, exact paths, UID 501 ownership, realpath/no-symlink boundaries,
tracked/untracked/ignored contents, package reproducibility, recovery refs and
open file handles were checked. The Classic worktree was clean and all ignored
files were inside reproducible `prototype/node_modules`; its sole patch was
already equivalent on main, its branch/ref was backed up, and canonical/CW
dependency ownership was retained. Ordinary `git worktree remove` completed
without force. Compiler-cache databases were only Xcode `XCBuildData/build.db`.

| Removed path | Files/links counted | Logical bytes |
| --- | ---: | ---: |
| Canonical `.build/out` compiler cache | 12,757 | 1,698,760,391 |
| Canonical `.build/apple` compiler cache | 7,565 | 1,680,586,093 |
| Inactive `~/.codex/worktrees/cluster-classic/OM0RX-xLog` plus reproducible dependencies | 11,172 | 257,774,201 |
| **Total** | **31,494** | **3,637,120,685** |

These are logical removed sizes, not measured physical space reclaimed. No app
or installer package was removed in this pass; the prior 18-app/six-installer
cleanup remains a separate historical total. Current app, verified rollback,
staged signed bundle, canonical/CW dependencies, source refs/stashes, release
evidence, protected backups, databases, settings, credentials, recordings and
exports were retained. No blanket clean, hard reset or force push was used.

After this documentation is committed/pushed, its containing commit is the final
canonical main identity; the application source stays `07957050`. Stop here.
