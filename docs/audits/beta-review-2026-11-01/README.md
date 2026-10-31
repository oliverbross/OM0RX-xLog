# Beta review — 2026-11-01

Work was performed in the canonical `main` checkout. The review covers database read cost and cache coherence, window read lifecycles, automatic rotor preference continuity, new-user setup, platform credential storage and installer payloads. No production contact or hardware mutation was used for these tests.

## Evidence established before packaging

- Native Rust: 973 unit and 31 integration tests passed, one test thread, including rotor continuity and About/menu authority checks. The two subsequent atomic menu-hint regressions also passed their focused run.
- [Native macOS core validation](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41244081445) on source `383f25ce`: 1,305 XCTest cases (nine explicit skips, zero failures) and 586 Swift Testing tests passed. Windows and Linux qualification is tracked separately; a successful Mac result does not qualify those platforms.
- Database: targeted history/projection/aggregate tests passed. The final rollback and HM snapshot batch passed 15 tests, including a provisional revision reused by an external writer after rollback and seven derived views compared with a fresh database.
- A disposable 100,000-contact fixture measured a first list read around 2 ms and statistics around 21 ms. These are database observations, not promises for complete WebView rendering. Bulk import time is separate.
- An independent 20,000-contact query fixture returned identical projected history with an indexed UNION/scalar query around 67 ms, compared with around 652 ms for full-record decoding. The fixture included 5,001 matching rows with large unrelated JSON fields.
- The clean frontend suite passed 4,960 Vitest tests across 354 files and six Node checks. Follow-up onboarding/registry/Chaser tests and TypeScript checks passed. A later production frontend build passed all window budgets. The final package workflow repeats the complete checks on its exact source.
- The [window audit](../window-performance-2026-11-01/README.md) records all registered module imports, synthetic browser timing and its explicit native acceptance limits.
- Twelve release-payload tests and five archive extraction tests passed. A read-only scan of the existing 1.3.71 Mac bundle found no operator data among 3,622 files. A fresh pinned Windows Python/contest-source prerequisite scan passed 2,484 files. Every final application payload must be scanned again.
- Linux packaging metadata, permissions and version regressions passed. The private Linux C vault smoke passed in native CI after correcting two fixture lifecycle bugs; the full Linux Swift suite and private Swift vault remain separate gates. Native Windows installer parsing passed; actual installer/runtime acceptance remains required.
- A private macOS 14/arm64 prerequisite build passed for CPython 3.12.16, OpenSSL 3.6.4 and XZ 5.8.4. It uses a pinned public Mozilla CA bundle (118 roots), with no inherited local certificate selection. Build/source/compiler/SDK receipts and library hashes were retained. This is a prerequisite result, not application installation acceptance.

## Findings fixed

Indexed callsign reads replace broad scans and unnecessary full-record decoding. QSO-owned revisions keep aggregates warm through unrelated workspace writes. Rollback invalidates provisional caches and HM metadata. HM reads use a coherent SQLite snapshot without taking over a caller's transaction.

Recent window reads are bounded and revision-scoped; optional prewarming is rate-limited. Hidden periodic work pauses. Auto rotor preserves enabled intent through safety pauses while keeping explicit Stop/manual/uncertain-state resume rules. Fresh operator defaults contain no developer station identity; existing settings and logs suppress first-run enrollment. Unfinished CW Decode is opt-in. Remote amplifier/tuner details follow actual provider ownership.

Installer work adds audited payload maps, privacy gates and native install/uninstall acceptance. macOS CI moves off the retiring macOS 14 runner. Ordinary CI builds and tests without repeatedly packaging an already used software version.

Additional native review found older SQLite JSON extraction truncating embedded NUL strings, Linux JSON bridge comparisons rejecting unchanged state, incorrect private station-owner retirement, and a Windows Python launch missing its OS-derived system directory. Focused regressions cover these cases. The packaged contest self-test exercises the shipping bundled locator, sanitized subprocess, synthetic save/read and restart/reopen path.

All platforms stage only tracked contest host/vendor source. The Mac lane now shares the same source-only staging policy, so tests, fixtures and untracked local files are ineligible. Four staging privacy tests passed, including a synthetic private file and a changed-parent symlink; seven native bundle fixture tests and twelve Mac packaging/refusal checks passed. macOS packaging uses production Cargo artifacts, retains strict resource/provenance checks, and preserves the existing signing/notarization gates.

## Release gates

This document records source and fixture review, not an installation or public-release acceptance. Final native CI results, all-window checks, signed/notarized Mac provenance, fresh production backup and preservation checks, and public asset verification must be recorded after they complete. Physical radio/rotor/amplifier and real account-provider acceptance remain distinct.
