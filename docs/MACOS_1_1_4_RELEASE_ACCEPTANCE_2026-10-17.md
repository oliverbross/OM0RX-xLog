# macOS 1.1.4 release acceptance — 17 October 2026

## Release identity

- Application: `OM0RX-xLog.app`
- Version: `1.1.4`
- Application source: `main` at `2dcf45d6ee75f52b601b691da021ec000a337187`
- Source state before packaging: clean, with `HEAD` exactly matching `origin/main`
- Bundle identifier: `com.oliverbross.xlog.integration`
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Hardened runtime: enabled (`Runtime Version=27.0.0`)
- Installed host SHA-256: `1477c4f540487950d5fe1fe3bb8060bc97c6f3d19ae4418b7a4ffe98a37ab107`
- Installed worker SHA-256: `cda2449b0c6bac15d55cc383c48246666ae4fea7ff768f61078924e345ff6778`
- Strict deep code-sign verification: passed after installation
- Replaced version: `1.1.3`
- Recoverable backup: `dist/installation-backups/1.1.3-before-1.1.4-20261017-1658/OM0RX-xLog.app`

## Permanent connectivity corrections

- Passive station, rotor, callsign/DXCC, logbook, cluster-history, reference, cluster-snapshot and WSJT-X snapshot reads use bounded non-retiring worker timeouts. A delayed read can no longer kill the shared worker and disconnect unrelated services.
- The retained cluster owner sends `cluster_resume` once at startup and once per replacement worker generation. Its one-second refresh loop now sends the passive `cluster_snapshot` request rather than repeating a potentially connecting operation.
- Cluster credential reads are cached for the worker lifetime, including successful, missing and denied reads. The one-second cluster projection poll no longer queries macOS Keychain for every configured server.
- Passive QRZ, online-log, automatic-sync, FTP and status credential reads have the same worker-lifetime positive/missing/error cache.
- Durable station connections are always noninteractive inside the worker. Missing or inaccessible saved tokens are rejected before network activity and recorded as terminal `rejected` receipts rather than ambiguous `unknown` operations that auto-retry after every worker restart.
- QRZ lookup is noninteractive and retains offline CTY/DXCC data when an online credential is unavailable. Credential authorization and replacement remain explicit Settings actions.
- Cluster credentials are resolved before connected resume intent is persisted.

## Automated validation

- Frontend: 211 test files and 3,060 tests passed with four constrained workers.
- Rust/Tauri: 602 tests passed, including passive-read isolation, cluster resume/snapshot sequencing, mutation timeout safety and station credential receipt behavior.
- Swift: full package test suite passed, including cluster credential caching/order, QRZ profile and station-session credential behavior.
- macOS packaging checks passed, including worker self-test, distribution metadata, TypeScript, Vite production build, window-bundle budgets, universal Swift worker staging and Developer ID signing.

## Installed live acceptance

The installed 1.1.4 bundle was launched from `/Applications/OM0RX-xLog.app` after the 1.1.3 bundle was moved to the recoverable backup above.

- Existing integrated workspace opened with 68,173 contacts; live operator activity subsequently increased the displayed count to 68,174 without a duplicate workspace being created.
- Remote Station Agent recovered automatically and displayed fresh receive frequency/mode plus amplifier/tuner telemetry.
- Rotor recovered automatically and displayed `ROTOR CONNECTED` with a fresh observed bearing of 245 degrees.
- ShackCQ displayed `Connected`; spot count advanced from 41 to 47 during observation.
- QRZ/DXCC lookup for `OM0AAO` left `Lookup pending` and completed in under one second, returning Viliam Petrik, JN88wt, Slovak Republic, DXCC 504, continent EU, CQ 15, ITU 28, distance and worked/confirmed history.
- A slash callsign retained its offline CTY approximation without remaining pending.
- The cluster `For` column visibly rendered the requested green-through-amber age strip.
- Main process PID 17871 and worker PID 17876 remained unchanged for more than two minutes, well beyond the former approximately 45-second restart cycle.
- The prior Keychain/security error signature had one match in the final 60-second observation window, rather than the earlier hundreds of repeated events.
- The operator independently reported that radio control and rotor operation were working fully after restart.

## Safety and evidence boundaries

- No PTT, CW, tune, transmit, amplifier-state change, rotor movement, short-path/long-path command or automatic-rotor activation was issued during acceptance.
- Radio acceptance is limited to connection and fresh receive/telemetry observation. Rotor acceptance is limited to connection and fresh bearing observation.
- Live panel movement/resizing and duplicate-warning placement are covered by the committed frontend regressions; they were not exercised while the operator was actively using the station.
- The Security.framework event count is a diagnostic heuristic, not a proof that macOS will never request authorization after a future credential or signing-identity change.
