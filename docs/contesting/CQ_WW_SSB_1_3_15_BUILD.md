# macOS 1.3.15 — entry multiplier status

Application change: `2a8b7d4fda7b8d39789febc7bfa27c1aacf2d28c`.
Build from clean canonical main using `bash prototype/scripts/package-macos.sh`.
The release commit containing this version change is embedded as sourceCommit in
DistributionMetadata/components.json and Not1MM/python-runtime.json. Installed
exact-source verification will be recorded after packaging.

CQ WW SSB/CW entry now distinguishes new zone, new country, both and no new
multiplier from the credited contest log and received exchange. DUPE retains
priority. Pending call, zone and frequency changes suppress stale status.
Other contest rules and Multi-Op clients retain their previous status behavior.

Pre-package validation: 96 Python, 13 focused frontend and one native protocol
regression passed, plus TypeScript and independent diff review. Existing 1.3.14
forwarding acceptance is reused for unchanged code. Macro completeness is
recorded separately in [the audit](MACRO_STATUS_2026-10-25.md); no hardware CW,
recorded audio, routing, PTT or transmitter acceptance is claimed.

Installation must preserve a fresh log/settings backup and signed 1.3.14 rollback.
No production test QSOs or RF/PTT/rotor commands are part of this release check.

## Installed acceptance — READY WITH LIMITATIONS

Installed exact source: `95ff278f82a06bd0013e7f2dd61dbec2fece12a5`.
Both embedded receipts match; candidate and installed binary/component hashes
match. Developer ID deep/strict signature checks passed; notarization unclaimed.

Candidate and installed packaged Python each passed 35 CQ WW SSB/Analytics
disposable tests. All 35 isolated native acceptance checks passed with station
I/O disabled. These native checks cover normal logging, not a complete contest
UI rehearsal. The feature-specific tests above cover multiplier behavior.

Fresh backup preserved 339 contacts, 30 databases and 55 settings/service files.
All QSO, identity and audit rows matched exactly before relaunch. Existing
contest Main Logging reopened with 339 contacts, score 45900 and live frequency.
ShackCQ reconnected with classified 40m spots. The operator resumed, so the
planned multiplier UI interaction was not performed; no production test QSO or
draft change was made. Physical Maestro display remains operator confirmation
for this version; unchanged delivery code retains prior 1.3.14 acceptance.

Backup: `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.15-before-install-20261025-complete`.
Rollback: `/Applications/OM0RX-xLog-previous-1.3.14-20261025.app`.
The first backup attempt stopped due to an older system Python; the complete
backup above was rerun with bundled Python 3.12 before replacement.

[Exact-source evidence](evidence/cq-ww-ssb-1.3.15/release-verification.json).
