# Contesting Test worker process acceptance

This gate exercises the real `xlog-prototype-worker` process through its newline-delimited JSON interface. It is narrower than application acceptance: it does not build or launch the Rust host, render the UI, install an app, contact hardware or services, or prove the final signed package.

The harness stages a minimal bootstrap `.app` directory containing the freshly built worker, its Swift resource bundle, and an `Info.plist` with the compile-bound Contesting Test identifier. The fixture exists only because `AppRuntimeProfile` rejects the Contesting Test argument unless the worker is inside the expected bundle identity. It is not the final OM0RX-xLog Contesting Test application package.

Run from the isolated contesting worktree:

```sh
set -o pipefail
source_sha="$(git rev-parse HEAD)"
node prototype/scripts/build-contesting-worker-process.mjs \
  --scratch-path "/tmp/xlog-contesting-worker-build-${source_sha}" \
  --output "/tmp/xlog-contesting-worker-build-${source_sha}.json" \
  2>&1 | tee "/tmp/xlog-contesting-worker-build-${source_sha}.log"

node prototype/scripts/accept-contesting-worker-process.mjs \
  --build-manifest "/tmp/xlog-contesting-worker-build-${source_sha}.json" \
  --expected-head "$source_sha" \
  --output "/tmp/xlog-contesting-worker-process-$(date +%Y%m%d-%H%M%S)" \
  2>&1 | tee "/tmp/xlog-contesting-worker-process-${source_sha}.log"
```

The scratch path, build manifest, build log, acceptance output, and acceptance log must not already exist. `pipefail` preserves a helper or harness failure through `tee`, while `2>&1` records both output streams. The build helper requires clean compiled inputs, streams the long Swift build instead of buffering it, makes a fresh release worker with two build jobs, and records the full command, source commit, Swift toolchain, executable hash, and content-hashed resource manifest. Acceptance verifies those hashes before staging, hashes the staged artifacts actually launched, and verifies them again after both worker lifecycles.

The harness records requests, framed responses, process exits, stderr, descriptor checks, protected-path metadata snapshots, and a content-hashed inventory of the synthetic home. It writes partial evidence and terminates remaining children if a request, assertion, output parser, or process fails. It fails if:

- the source `HEAD` is not the reviewed integrated commit;
- a test bundle starts without the explicit Contesting Test profile argument;
- health does not report the isolated test profile;
- a contest request becomes usable before an empty workspace is created;
- CQ WW or CQ WPX create, draft, reserve, commit, read, replay, receipt, or restart recovery fails;
- a full QSO read, country-changing correction, deletion tombstone, exact post-restart replay, or mutation receipt fails;
- correction accepts caller-supplied entity data, or stale generation/revision fences are bypassed;
- a corrected contact does not revalidate the operating draft duplicate state, or deletion/recommit reuses an allocated WPX serial;
- an external service request is admitted;
- the worker owns a network socket or radio-like device descriptor during the sampled checks;
- any protected production database or SQLite sidecar metadata changes; or
- a same-toolchain Foundation probe does not resolve Application Support inside the synthetic home before the worker starts; or
- the observed Contesting Test support root is not inside that synthetic home.

The descriptor checks are sampled process evidence. The stronger prevention boundary remains the immutable runtime profile and backend admission policy. `health.network_contact`, `health.credentials_accessed`, and `health.station_io` must all be false. Worker children receive a small explicit environment containing system paths, locale, UTC, and synthetic home/cache/temp locations; they do not inherit credentials, loader overrides, or service configuration. The harness never reads production database contents.

The harness does not monitor every filesystem path. Its outside-root evidence is limited to before/after metadata for the two protected production SQLite databases and their sidecars, plus the observed synthetic test support root. The synthetic-home inventory covers only that home. The acceptance harness and documentation may be uncommitted while they collect evidence, but `Package.swift`, `Sources`, and `Tests` must match the expected commit. Re-run this gate for the final packaged application after the approved main-line merge.

## Accepted correction/deletion extension

The reviewed extension passed on 18 October 2026 at exact clean source `46ee0c3f033024c68db045ec9935d64d012b31fd`. It retains the bootstrap, profile, synthetic home, external-I/O denials, descriptor samples, protected metadata checks, normal isolated-log zero assertions, and build-manifest provenance. Each framed exchange receives a monotonically numbered `operation` in the evidence report, which also records its exact process lifecycle and method. The source bounds the two-process scenario to exactly 57 framed operations and fails if that ledger changes without review.

After the first WPX contact is committed with serial `001`, the extended scenario exercises these checks:

1. read the complete revision-bound QSO and verify its original UTC, resolved DL entity, operator provenance, sent exchange, and allocated serial;
2. reject a generation-mismatched read;
3. reserve serial `002`, apply a synthetic K1ABC operating draft, and verify that it is initially clear;
4. reject a correction containing caller-supplied entity data and reject a separately identified stale-revision correction;
5. correct the stored DL contact to K1ABC using the entity-free full-QSO payload derived from the read, verify the server-resolved K entity and rescored scalar result, and retrieve its durable receipt;
6. reread the operating draft and require duplicate state while preserving its fields and active serial `002`;
7. delete the corrected contact, require a tombstone on full-QSO read, retrieve the deletion receipt, and require the same draft to become clear without losing serial `002`;
8. commit that draft with serial `002` and require the next reservation to be `003`; and
9. restart the real worker, verify both mutation receipts, require the original tombstoned commit replay to return `qso_deleted`, replay the live replacement commit exactly, replay the exact correction and deletion responses after the later delete/recommit sequence, recheck the tombstone, and verify the replacement live contact uses serial `002`.

The new helper has a focused Node test proving that correction construction removes `entity` and refuses harness changes to immutable identity, UTC, provenance, sent allocation, rule, and reference fields. Source validation is not worker-process acceptance. A fresh release worker and new evidence directory must be produced only after this script is reviewed and committed; the historical binary below does not contain or test the integrated correction/deletion implementation.

The accepted `46ee0c3` worker was freshly built with Apple Swift 6.4, the Xcode
build system and two jobs. It is 37,104,376 bytes, SHA-256
`1cc7fc4d6c28adfd555200d626aa2aa2c6e1e5b12099d21b8ec543b3e4c49d37`.
The resource tree is `748093a0e25253926e8440a7afc997947da0211c1a7d11ee4d695e57cdc3d1b3`;
the build manifest is `157e21b7b2f2cf206dc8227d54cba1070579b44dbae6f2947ddb43b4bd7275ef`.
The first attempt completed all behavioral checks but failed the protected
metadata assertion during concurrent Integrated Preview activity. It remains
rejected and preserved. An acceptance-only retry reused the exact manifest,
worker and resources in a fresh evidence directory after a metadata-only
preflight. No source changes or rebuild occurred between attempts.

The actual retry gate passed all 19 assertions and all 57 exchanges, with 41
frames in the first worker and 16 after restart. Both exited zero with empty
stderr. Protected database and sidecar metadata matched across the gate,
contents were not read, the normal isolated log remained empty, and staged
artifact hashes were unchanged. Evidence is preserved in the corrections
worktree under `dist/contesting-test/acceptance/46ee0c3f033024c68db045ec9935d64d012b31fd-worker-process-57-retry1/`;
`evidence/acceptance.json` has SHA-256
`4a291b8309530887dd723c1d5a7812686917583de28b2dfb55ffb9247d977e19`.
This is worker-only correction/deletion acceptance. It predates the later
export transport/projection/native-save integrations and does not validate
their runtime, a final Test.app, native UI, hardware, or other operating systems.

## Accepted worker-process run

The historical real-process gate passed on 17 October 2026 at clean source `ff2b8e3476187ed19db0711aa16786a90bad2165`, using Apple Swift 6.4 (`swiftlang-6.4.0.34.1`, target `arm64-apple-macosx27.0.0`). The fresh release build used the recorded two-job SwiftPM/Xcode command. Its worker was 35,711,176 bytes with SHA-256 `6dab1e5b431a7a39f3136b978e0705c37d9cf6e85b65f7efbf3d14738c85c4ad`; the resource manifest tree SHA-256 was `748093a0e25253926e8440a7afc997947da0211c1a7d11ee4d695e57cdc3d1b3`. The build manifest SHA-256 was `8f6f6ed096276a5e90d40ac1391b50c351ba054362338834c217afd4ce300f6b`.

The harness completed 35 framed exchanges across the initial process and a clean restart; both exited zero with empty stderr. It proved missing-profile failure, isolated health and Foundation support-root resolution, empty-workspace onboarding, CQ WW scoring at 3 points / 2 multipliers / claimed score 6, CQ WPX reserve and commit at 2 points / 1 multiplier / claimed score 2, exact mutation replay, durable receipts and reopen after restart. It did not simulate a crash. Cluster, station, online-log and network lookup requests were denied. The separate normal isolated logbook remained at zero QSOs, pending sync operations and outbox entries. Staged executable and resource hashes were unchanged after the run. The protected normal production database and sidecars remained absent; the existing Integrated Preview database and sidecar metadata were unchanged, without reading their contents.

No network sockets or radio-like device descriptors were present in the three worker samples taken at initial startup, after mutations and after restart. These bounded samples do not prove that no external activity was possible at every instant; the runtime profile and backend admission policy remain the enforcement boundary. Credential absence is the worker's health report plus the reviewed admission policy, not independent keychain tracing. The evidence also does not exercise the Rust host, final `.app` packaging, installation, rendered UI, native menu, signing identity, or hardware. The original `/tmp` evidence was retained, and a local ignored copy is under `dist/contesting-test/acceptance/ff2b8e3-worker-process/`; raw evidence and executables are not committed.
