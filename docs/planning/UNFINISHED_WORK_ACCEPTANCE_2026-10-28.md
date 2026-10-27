# Unfinished-work protection — 28 October 2026

## Scope and source checkpoint

One bounded reliability task under existing **W06** (identity-bound notes), **W19** (read-only learning evidence), **W21** (clear editor/navigation outcomes) and **W24** (native shutdown/restart/release acceptance). No new feature wave, database persistence owner, scoring engine or submission mechanism is introduced.

Canonical `main` was clean at **703d56f1**. One fetch and fast-forward-only pull found it current; all newer accepted work is preserved. Installed production remains **1.3.54**, executable source **0bb3759b7b6f4d9b46fb55ed0411390662f604e8**. This task does not authorize installation. Existing Wave 5 and earlier evidence is reused only within its original boundaries.

**1.3.55 is reserved as the next unused candidate.** The exact clean source is resolved by the existing canonical `prototype/scripts/package-macos.sh` at packaging and recorded with embedded native/distribution/Python/CW provenance, signed component identities and retained bundle receipts. This reservation is not a claim of candidate acceptance. Final native results and source identity will be recorded below after verification.

## Retention contract

- Unsent note and learning text uses the existing WebKit-origin local-storage mechanism. Fixed 300 ms write deadlines bound writes during continuous typing; controlled navigation and acknowledged native close/Quit flush synchronously. No per-keystroke database mutation, transaction, score refresh, upload or submitted-snapshot update is added.
- Each editor has a separate record. Notes capture workspace generation, contest session, original draft/QSO, lane and receiver binding. Learning captures workspace/session, immutable analysis identity, reference and source revision. Opening another caller/lane/snapshot cannot rebind the record. A stale learning target stays available for copy/discard, with inspection/export blocked against the new snapshot.
- “Draft retained locally” appears only after a successful storage write/readback. This is editor recovery, not “Note saved”, an exported report, logged QSO or submitted record. Pending input and write failures have separate visible states.
- Explicit note Save retains the original operation ID and attempted-save journal. New operations have independent keys; existing legacy uncertain-save records remain readable. An uncertain outcome disables editing/discard and reconciles the same operation. Only confirmed completion removes its linked unsent record. Confirmed rejection retains editable text before retiring the attempted journal.
- Cancel note retains text and says so. Discard draft deliberately removes only that editor record. Learning report Save remains explicit; cancelled/failed export retains the annotation. Only confirmed native export success or deliberate discard can clear its record.
- Malformed bytes remain readable/copyable; archive uses the existing write/readback/compare-before-remove behavior. Storage/quota/concurrent-writer failures remain visible and refuse silent overwrite. Controlled navigation/close preparation fails rather than acknowledging a failed flush.
- Dock Quit routes Cocoa’s missing delegate termination-veto selector into the existing application-owned exit preparation, preserving menu Quit/Command-Q and output Stop/release owners. Normal logging reuses its existing preparation/unsaved-field guard. Analytics and Contest Setup close acknowledge only after preparation. OS shutdown/logout/reboot is unverified; none is exercised.
- Post-Quit verification uses `verify_macos_app_stopped` and exact executable paths. It cannot launch or signal an application and fails closed on inventory errors. A stopped binding is never observed again; reopening requires a separate deliberate exact-path launch.

## Evidence in progress

Early actual-native inspection used the unchanged signed 1.3.54 candidate in a fresh marked private disposable root, `/private/tmp/xlog-wave1-unfinished-317ksj3b`, with a new WebKit UUID. Main Logging displayed the actual WPX draft. Command-Q after unblurred received exchange `327` exited PID 79273. Process-only inspection found it absent and production app/worker 73538/73544 still running. This is early baseline/path evidence, not final candidate acceptance.

Source gates: **910 Rust unit + 26 integration** cases pass, plus TypeScript, two Node contact-identity cases, six packaging checks and the process-only inspection/installer regression. The broad UI run passed **333 files / 4,688 cases**, retaining two failures in the changed note-boundary file; it is not described as an uninterrupted green suite. Both delayed Last-QSO selection and concurrent legacy-attempt protection pass on the final implementation's affected-file reruns. The final focused set covers notes, learning, concurrent writers, fixed write deadlines, quota/read failures, archive verification, Analytics close/navigation, Setup close and correlated preparation. The final focused run passes **59 cases / 7 files**, with the exact log retained. Existing unaffected backend/Swift/scoring and prior Wave 5 physical restrictions are reused; no unrelated backend change is made.

The unchanged actual bundled Python host passed its four complete-log/delayed-note/replay/submission boundaries. Signed candidate and final native finite results are pending.

## Remaining limits

Local-storage readback is not a filesystem fsync guarantee. The final acceptance must state the measured interrupted-process recovery boundary separately from the 300 ms pending renderer interval; no unconditional power-loss/force-quit durability or veto is promised. Unavailable storage cannot preserve new bytes across process death; the UI must retain them in memory, disclose failure and block controlled retirement.

Historical Clear initiators remain **unattributed**. This task does not reopen that investigation or alter Clear/Wipe/Stop bindings. No production UI/store fixture, installation, production recovery/rescore, provider/sync/upload, radio/PTT/RF/rotor or physical audio action is authorized. CW decoding, Reply and unqualified physical dual-radio routes remain restricted. Existing logs, drafts, recordings, settings, backups, archived rollbacks and recovery refs remain protected.
