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
