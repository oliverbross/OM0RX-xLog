# 1.5.17 Mac qualification and cross-platform hold

Source `6e3dc9746e4fe25df52c44d1ae1b365a4c89bce0`; archive SHA-256
`a9d0503123b9bae303b39fd60a4be6dec1da5f80325db380d580079cb62f8f7c`.
Signed host `fd4c44922b01458c2826a535d42811683959b027cbf0d284855f5f2e7fd969c4`;
worker `0d9ce0c4b49b3d752a4afa17759d08c486a94ee7a8d7a0fcbe737c8d87f3b139`.
Strict signatures, arm64 slices, ZIP/manifest identity, privacy and all nine
signed-worker tests passed with existing deadlines. Nothing was installed or
published.

The ZIP-extracted native app used a fresh private marked root and
`normal_logging`; original/restarted host and matching worker executable,
PID, parent and complete arguments were positively verified before every
observation/input. Both native windows displayed the same private marker.
The wizard completed through keyboard Tab/Enter using `K1TEST`, `K1TEST/P`,
`FN31PR`, `Isolated quality fixture`, and non-default **37 W**. Equipment was
skipped; no external I/O, radio, audio/PTT/TX or rotor action was issued.

Before any edit, read-only inspection verified the first `K1SYN` contact had
the configured own station/operator/grid/location and 37 W, 20m SSB at
14,250,000 Hz. This positively repeats the failed 1.5.16 boundary. Native search,
comment edit to `QUALITY / edited 1.5.17 — Žilina`, ordinary Quit, process-only
stopped proof, explicit same-root restart and one-row/settings persistence
passed. A second ordinary Quit stopped the owned host and worker.

The independent post-native checker inspected the original durable first-save
receipt as well as the final row, preventing comment editing from masking an
initial omission. It verified settings, edit receipt, integrity, original and
restarted process proofs, and exact signed source/worker. A separately explicit
private worker exported ADIF with `OPERATOR`, `STATION_CALLSIGN`,
`MY_GRIDSQUARE` and `TX_PWR=37`, exited through ordinary EOF, and left logical
QSO/settings/receipt content unchanged. Raw synthetic evidence and coordinates
remain local under `.build/quality-native-1.5.17`.

Packaged completed-request checks passed: 20k reads after 1k warmup gave zero
rounded footprint growth on empty data and decreasing compressed footprint on
generated 100k. On the protected 69,695-live fixture, footprint was
22.2→22.3 MiB (~0.1 MiB rounded growth), versus 28.2→147.3 MiB for released
1.5.15. Full logical QSO and private-file preservation checks passed. These are
offline worker measurements with uncontrolled caches/ambient builds, not the
whole desktop idle budget or complete original htop incident.

## Cross-platform hold

Gate `41983234450` failed Linux frontend test
`retains invalid historical editor buffers across menu navigation and Close requests`.
It could no longer find `Frequency MHz` after navigation. Independent actual
React-hook reproduction found a first-commit input-loss race, now corrected in
`59cf0cfa`. The exact original Linux schedule remains inferred; the failed run
and reproduction are retained. See [the editor evidence](editor-first-input-race.md).

The Mac checks above remain valid bounded evidence, but 1.5.17 is not accepted
as a cross-platform candidate. The next source package must advance to 1.5.18;
partial/superseded CI jobs do not count as completed native acceptance. Actual
Windows standard-user/UAC, equipment Browse/Save, upgrade/media retention,
physical devices and complete platform parity remain open.
