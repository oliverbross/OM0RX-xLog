# Contesting Test worker process acceptance

This gate exercises the real `xlog-prototype-worker` process through its newline-delimited JSON interface. It is narrower than application acceptance: it does not build or launch the Rust host, render the UI, install an app, contact hardware or services, or prove the final signed package.

The harness stages a minimal bootstrap `.app` directory containing the freshly built worker, its Swift resource bundle, and an `Info.plist` with the compile-bound Contesting Test identifier. The fixture exists only because `AppRuntimeProfile` rejects the Contesting Test argument unless the worker is inside the expected bundle identity. It is not the final OM0RX-xLog Contesting Test application package.

Run from the isolated contesting worktree:

```sh
source_sha="$(git rev-parse HEAD)"
node prototype/scripts/build-contesting-worker-process.mjs \
  --scratch-path "/tmp/xlog-contesting-worker-build-${source_sha}" \
  --output "/tmp/xlog-contesting-worker-build-${source_sha}.json"

node prototype/scripts/accept-contesting-worker-process.mjs \
  --build-manifest "/tmp/xlog-contesting-worker-build-${source_sha}.json" \
  --expected-head "$source_sha" \
  --output "/tmp/xlog-contesting-worker-process-$(date +%Y%m%d-%H%M%S)"
```

The scratch path, build manifest, and acceptance output must not already exist. The build helper requires clean compiled inputs, makes a fresh release worker with two build jobs, and records the full command, source commit, Swift toolchain, executable hash, and content-hashed resource manifest. Acceptance verifies those hashes before staging, hashes the staged artifacts actually launched, and verifies them again after both worker lifecycles.

The harness records requests, framed responses, process exits, stderr, descriptor checks, protected-path metadata snapshots, and a content-hashed inventory of the synthetic home. It writes partial evidence and terminates remaining children if a request, assertion, output parser, or process fails. It fails if:

- the source `HEAD` is not the reviewed integrated commit;
- a test bundle starts without the explicit Contesting Test profile argument;
- health does not report the isolated test profile;
- a contest request becomes usable before an empty workspace is created;
- CQ WW or CQ WPX create, draft, reserve, commit, read, replay, receipt, or restart recovery fails;
- an external service request is admitted;
- the worker owns a network socket or radio-like device descriptor during the sampled checks;
- any protected production database or SQLite sidecar metadata changes; or
- a same-toolchain Foundation probe does not resolve Application Support inside the synthetic home before the worker starts; or
- the observed Contesting Test support root is not inside that synthetic home.

The descriptor checks are sampled process evidence. The stronger prevention boundary remains the immutable runtime profile and backend admission policy. `health.network_contact`, `health.credentials_accessed`, and `health.station_io` must all be false. Worker children receive a small explicit environment containing system paths, locale, UTC, and synthetic home/cache/temp locations; they do not inherit credentials, loader overrides, or service configuration. The harness never reads production database contents.

The harness does not monitor every filesystem path. Its outside-root evidence is limited to before/after metadata for the two protected production SQLite databases and their sidecars, plus the observed synthetic test support root. The synthetic-home inventory covers only that home. The acceptance harness and documentation may be uncommitted while they collect evidence, but `Package.swift`, `Sources`, and `Tests` must match the expected commit. Re-run this gate for the final packaged application after the approved main-line merge.

## Accepted worker-process run

The real-process gate passed on 17 October 2026 at clean source `ff2b8e3476187ed19db0711aa16786a90bad2165`, using Apple Swift 6.4 (`swiftlang-6.4.0.34.1`, target `arm64-apple-macosx27.0.0`). The fresh release build used the recorded two-job SwiftPM/Xcode command. Its worker was 35,711,176 bytes with SHA-256 `6dab1e5b431a7a39f3136b978e0705c37d9cf6e85b65f7efbf3d14738c85c4ad`; the resource manifest tree SHA-256 was `748093a0e25253926e8440a7afc997947da0211c1a7d11ee4d695e57cdc3d1b3`. The build manifest SHA-256 was `8f6f6ed096276a5e90d40ac1391b50c351ba054362338834c217afd4ce300f6b`.

The harness completed 35 framed exchanges across the initial process and a clean restart; both exited zero with empty stderr. It proved missing-profile failure, isolated health and Foundation support-root resolution, empty-workspace onboarding, CQ WW scoring at 3 points / 2 multipliers / claimed score 6, CQ WPX reserve and commit at 2 points / 1 multiplier / claimed score 2, exact mutation replay, durable receipts and reopen after restart. It did not simulate a crash. Cluster, station, online-log and network lookup requests were denied. The separate normal isolated logbook remained at zero QSOs, pending sync operations and outbox entries. Staged executable and resource hashes were unchanged after the run. The protected normal production database and sidecars remained absent; the existing Integrated Preview database and sidecar metadata were unchanged, without reading their contents.

No network sockets or radio-like device descriptors were present in the three worker samples taken at initial startup, after mutations and after restart. These bounded samples do not prove that no external activity was possible at every instant; the runtime profile and backend admission policy remain the enforcement boundary. Credential absence is the worker's health report plus the reviewed admission policy, not independent keychain tracing. The evidence also does not exercise the Rust host, final `.app` packaging, installation, rendered UI, native menu, signing identity, or hardware. The original `/tmp` evidence was retained, and a local ignored copy is under `dist/contesting-test/acceptance/ff2b8e3-worker-process/`; raw evidence and executables are not committed.
