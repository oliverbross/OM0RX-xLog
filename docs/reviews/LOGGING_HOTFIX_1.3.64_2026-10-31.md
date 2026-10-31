# macOS logging hotfix 1.3.64 — 31 October 2026

Application source before the version-only release change:
`8eeb0a7deece02b659342f5bc271ec657ab39cab` on canonical `main`.

## Changes

- `fb6c6fd5`: retain a leading `MM` Scottish operating prefix in
  `MM/LY3X/P`; retain ordinary trailing `/MM` suffix behavior. The existing
  enrichment guard now keeps Scotland's DXCC, zones and approximate position
  while using the Lithuanian home profile only for operator details.
- `01633283`: acknowledge durable local saves without waiting for the online-log
  delivery actor. Coalesce delivery scheduling and retire it on shutdown.
  Read the workspace QSO count without recomputing all statistics, and show
  immediate Saving QSO feedback until the verified receipt arrives.
- `8eeb0a7d`: background saved-layout reconciliation leaves visible or minimized
  windows alone and never requests foreground focus. Explicit window/menu/Dock
  presentation retains its existing activation path.

## Source verification

- 184 frontend tests passed across main/detached logging, draft receipts and
  workspace mode; delayed-save feedback is covered with a held receipt.
- Production TypeScript/Vite build and detached-window bundle gates passed.
- 141 native workspace tests passed against the final native change.
- 23 XCTest checks and 39 Swift Testing checks passed across callsign enrichment,
  runtime profiles, local logbook methods, durable drafts, online delivery and
  shutdown. The occupied online credential actor regression acknowledges the
  local save before releasing that actor.
- Eight CTY authority tests passed, including leading Scottish `MM`, trailing
  `/MM`, ordinary portable prefixes, exact exceptions and date rules.

## Build provenance and acceptance boundary

Build only from this clean canonical checkout with
`bash prototype/scripts/package-macos.sh`. The script resolves the exact
post-version commit into `XLOG_SOURCE_COMMIT`; `build.rs` verifies it against
HEAD and embeds it. `Contents/Resources/DistributionMetadata/components.json`
also records the exact source commit. Notarize the resulting bundle with
`prototype/scripts/notarize-macos.sh` without rebuilding it.

The packaged/installed acceptance record will identify that exact commit,
signing/notarization, private-root native checks, timing evidence, backup and
rollback path. Source verification above is not yet installed acceptance.
This is a bounded current-Mac hotfix, not an all-platform release qualification.

Baseline timing evidence is private under `.build/logging-fixes-20261031/`.
A read-only SQLite backup contained 69,550 live QSOs; no test QSO was written
to production. The old worker's steady-state save → workspace status → first
logbook page took 176–433 ms in that isolated test. It excludes real providers
and GUI rendering; its timings do not reproduce the operator's full delay.
