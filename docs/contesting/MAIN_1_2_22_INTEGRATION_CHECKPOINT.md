# Main 1.2.22 compatibility checkpoint

18 October 2026. This isolated merge combines contest review checkpoint
`28106a5d9697a32e26758d357510f8f6abcc68b1` (product composition `cbf8cc1`)
with the main chat's accepted release documentation/source lineage
`3b5ef7a629d1ec453305388b929939d707d0d719` on
`codex/contest-main-1-2-22-integration`.

The installed package was built from
`6c4dd993fd42f78d030a0e674f830ff339380842`. Root read the release acceptance
record, independently matched installed host and worker SHA-256 values to it,
verified the strict deep signature, and observed both installed processes.
The main chat owns canonical packaging and its subsequent 1.2.23 map-framing
changes. This checkpoint does not package or replace an application.

The merge is conflict-free. It preserves last-click-wins spot selection,
obsolete Read-radio journal recovery, removal of the Active QSO Follow control,
passive local radio-state refresh, and atomic or legacy-pair Agent tuning
capabilities. Existing contest navigation and Test-profile external-I/O guards
remain present. Swift product and test sources are unchanged by this merge.

## Validation on the merged source

| Check | Result | Log SHA-256 |
| --- | --- | --- |
| Contest UI, live-app/spot barrier, detached QSO, Operator Desk, QSO editor, Radio Settings and navigation | 402 tests passed across 27 files | `e39e74989449c2e8623c46a387628ec13f4c9f9b425c272b5e488b7a83a0bcb2` |
| TypeScript, Vite and window bundle checks | Passed | `c277960af169d21df56496f4cfa075535a7acf7cffd8d74357e8bb8868d18ac4` |
| Native station telemetry | 16 passed | `1d4c8ed3589251d8b35dc20ce09ad8a158a67115642cfd89790d38f2fffd1a81` |
| Native isolated-profile admission | 5 passed | `d719427fb81485457de20562a47a430d07dcfc258b3377541aa59626c0d2a36d` |

Two Node correction-helper assertions also passed. The initial frontend command
exited before collecting Vitest tests because the npm script and invocation both
supplied `maxWorkers`; the direct Vitest command corrected that invocation. No
source was changed for that error.

Logs are `/tmp/xlog-main-122-contest-frontend-final-20261018.log`,
`/tmp/xlog-main-122-contest-build-20261018.log`,
`/tmp/xlog-main-122-contest-native-telemetry-20261018.log` and
`/tmp/xlog-main-122-contest-native-admission-20261018.log` respectively.
Native commands use the compiled `contesting-test` feature, Test product and
identifier overrides, disabled bundle/external binaries and the isolated scratch
target `/tmp/om0rx-history-ui-rust`. No radio action or network fetch was made.

## Remaining work

The seven-definition catalog/editor activation and exclusive module ownership
are still separate implementation candidates. Integrate them only after their
review findings are repaired. The 14-profile operator harness is still under
development; its diagnostic runs do not accept this merged source. Full 94-entry
parity, feature acceptance, sponsor submissions, production background ingress,
packaged module switching and platform/runtime gates remain open. Reconcile the
latest installed accepted main source again before final delivery, including
1.2.23 when ready. Preserve the open parity workbook and its user lock.
