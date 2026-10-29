# Rust and native shell validation

Canonical main b892663915cbc0768b26dc5a7bf7ec116869e409; unchanged application inputs f3f6e3dee40af29cb6801ef8ee422c521629e168, version 1.3.60. No checkout source/test/config/dependency/report edits or Git commits.

All checks use cwd /Users/oliver/Documents/Projects/OM0RX-xLog/prototype/src-tauri and the new CARGO_TARGET_DIR=/Users/oliver/Documents/Projects/OM0RX-xLog/.build/phase7-validation-20261029-b8926639/rust. The first full test compiled dependencies there; later checks reuse that target only. The shared runner strips inherited XLOG_/XCW_ opt-ins, selects explicit test Python/private temp paths and denies contest UDP. Original targets were not cleaned.

| Check | Exit | Seconds | Result | Exact command |
| --- | ---: | ---: | --- | --- |
| RUST-FULL | 0 | 708.987 | 924 passed, 0 failed, 0 ignored, 0 filtered; 31 passed, 0 failed, 0 ignored, 0 filtered | cargo test --locked --jobs 2 |
| RUST-FEATURE-R2 | 0 | 32.127 | 931 passed, 0 failed, 0 ignored, 0 filtered | cargo test --locked --jobs 2 --bin xlog-prototype --features contesting-test |
| RUST-HAMLIB-DUMMY | 0 | 8.944 | 31 passed, 0 failed, 0 ignored, 0 filtered | cargo test --locked --jobs 2 --test hamlib_dummy -- --nocapture |
| RUST-TWO-SLOT-DUMMY | 0 | 1.39 | 1 passed, 0 failed, 0 ignored, 923 filtered | cargo test --locked --jobs 2 --bin xlog-prototype station_session::tests::opt_in_two_slot_saved_profiles_connect_real_bundled_dummy_receivers_independently -- --exact --nocapture |
| RUST-CLIPPY | 0 | 155.853 | completed; warnings retained | cargo clippy --locked --jobs 2 --all-targets |
| RUST-RELEASE | 0 | 600.335 | completed; warnings retained | cargo build --locked --release --jobs 2 |


Exact commands, UTC boundaries, source heads, empty diffs, environments and raw-log hashes are in results.json and ../../checks/<ID>.json. Counts overlap across configurations/reruns.

## Discovery and dummy scope

Default harness: 924 unit +31 integration; feature binary: 931. No reported ignored tests. Two default cases silently return without Hamlib opt-in (tests/hamlib_dummy.rs:39-45 and src/station_session.rs:1054-1055). Feature includes the latter and excludes the separate integration target. Target cfg exclusions remain outside this macOS run. Raw pass totals alone therefore do not prove daemon integration.

The explicit 31-case dummy run and selected two-slot unit case exercised model 1 backends on local ephemeral ports/private temp JSON, allow_transmit=false, PTT-on rejection and owned cleanup. They used installed /opt/homebrew/bin/{rigctld,rotctld}, whose hashes are in preservation.json, not staged packaged helpers. This establishes local dummy protocol/session behavior only. No real provider/station, physical hardware, native GUI, audio capture, RF, bundle, installation or packaged-helper acceptance was attempted.

Original RUST-FEATURE displays 931 passing tests but its detached driver disappeared before receipt finalization; cause unproven. It is INCOMPLETE_RUNNER in orphan-feature.json, superseded by completed R2. Earlier foreground driver explicitly hit lean-ctx 120s cap before feature started. Tool failures and unsuccessful runner attempts remain in tooling-notes.json. No application failure was reclassified as flaky; no assertion changed.

## Warnings

warnings.json preserves every emitted header, compiler summary and Clippy category. Full test: 14 dead-code/unused diagnostics (9 integration, 5 binary). Clippy: 10 integration + 32 binary + 46 test warnings, with 26 duplicates (= 62 emitted headers), including style/complexity, needless borrows/clones, guarded unnecessary unwrap and constant assertion. Exit 0 uses existing lint policy, not warnings-as-errors. No suppression or fix applied. Release emitted 5 diagnostics; the dummy integration emitted 14; accepted feature and selected two-slot runs emitted none.

## Safety and remaining findings

coverage.json lists actual passed role/admission/profile/module/shutdown case names. Existing passed tests cover closed surface capabilities/raw-device denial, role/isolation/shutdown guards, operating-module admission, runtime external-I/O denial and seven native feature-admission cases. The seven shutdown fixtures cover EOF drain/synthetic release, watchdog deadline, nonzero child, spot/station failure translation, unsolicited EOF, missing reply and malformed final reply (worker.rs:2562-2672).

- FA-010 remains open: fldigi acquisition routing tests do not inject a settings-write failure before production RX.
- FA-011 remains open: synthetic StationReleaseFailure/exit 74 translation does not exercise swallowed production direct-agent release errors through registry/worker.
- FA-012 remains open: Rust checks do not exercise Swift connect-before-registration/install-during-connect/reconnect schedules.

Fixture passes cannot close those production mechanisms or prove physical release.

## CI and preservation

prototype.yml:163-182 separately runs locked contracts and staged-helper dummy integration; contest-portability.yml:364-416 discovers/runs bounded feature export/admission/passive/module/durable/restart/shutdown cases. This is workflow-source inspection, not current CI or Windows/Linux acceptance. Locked inputs are unchanged; no fresh external security/advisory scan is claimed. Blocked cargo-audit/custom Swift executables were not retried or wrapped.

Preservation: 1838 baseline inputs checked; 0 mismatches; Git status clean. Every completed receipt begins/ends at b8926639 with empty source diff. Cargo input/helper hashes are in preservation.json. All build trees/evidence retained; no cargo clean, packaging, installation or deletion.
