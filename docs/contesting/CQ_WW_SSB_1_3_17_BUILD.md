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
