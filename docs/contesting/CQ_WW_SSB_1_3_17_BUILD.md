# macOS 1.3.17 — callsign Checking recovery

Recovery implementation: `362ee467`. Build from clean canonical main with
`bash prototype/scripts/package-macos.sh`. The version commit is embedded as
sourceCommit in DistributionMetadata/components.json and Not1MM/python-runtime.json.

The owner checks its durable action queue every second while idle so a lost wake
cannot strand an entry edit. Detached windows refresh snapshots every 500 ms only
while waiting for an action receipt, recovering lost projection/completion wakes.
Neither recovery path resubmits an action. Existing context/revision checks remain.

Both regressions failed before the fix. All 202 entry/owner tests, TypeScript and
independent review passed. A restart recovered the reported live incident; there
is no IPC trace proving that lost wakes were its sole cause.

The concurrent recorder task is preserved outside this clean candidate. No recorder
feature, real audio capture or playback is included. Prior 1.3.16 spot formatting
and operator-confirmed Flex/Maestro delivery are retained. Production contact data
is not used for test writes. Installed evidence and rollback follow after packaging.

## Installed acceptance — READY WITH LIMITATIONS

Exact installed source: `1f15a88dd076f50ff77e0a08d1db350d489eb348`.
Both embedded receipts match; installed/candidate binary and component hashes
match. Developer ID deep/strict signatures passed; notarization unclaimed.
Candidate and installed packaged Python each passed 35 disposable checks. All
35 isolated native checks passed with station I/O disabled. The feature-specific
202 entry/owner tests and independent review are reused for this unchanged fix.

Fresh backup preserved 351 contacts. All QSO, identity and audit rows matched
exactly before relaunch. No test contact or station action was performed. The
existing contest reopened; accepted radio-delivery inventory is recorded in the
receipt. Physical Maestro display retains the prior 1.3.16 operator confirmation
for unchanged forwarding behavior; it is not claimed as newly hardware-tested.

Backup: `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.17-before-install-20261025`.
Rollback: `/Applications/OM0RX-xLog-previous-1.3.16-20261025.app`.
Recorder work remains recoverable in checkpoint `a7c3dfa7f36f67589a9f84fa87405ecbc91dfee3`
and `/Users/oliver/Documents/Backups/OM0RX-xLog-recorder-checkpoint-20261025`.
No unfinished recorder code was included in this candidate.

[Installed source evidence](evidence/cq-ww-ssb-1.3.17/release-verification.json).
