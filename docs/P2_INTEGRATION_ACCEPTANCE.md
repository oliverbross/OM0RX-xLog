# P2a — shared station and cluster foundation

Date: 2026-10-12. Branch: `codex/unified-xlog-integration-p2`.
Starting revision: `453b8e832e36f86051919619dd155999204f86e4`.
Verified Mac application source: `3ff72c52c885c5d61eb59eb457dc459922e005a6`.

## Mac-first operator preview

The operator requested Mac-first iteration before further Windows/Linux compilation. Automatic prototype CI now runs macOS only; the full matrix remains an explicit `workflow_dispatch` choice (`build_platforms: all`) for after Mac feedback. Run `38211567119` was cancelled at the operator's request, not accepted as a P2 cross-platform result. No runtime-only follow-up was dispatched. Original Mac application CI `38211567080` succeeded at the application source above.

The separate ad-hoc development application was installed and opened at `/Applications/OM0RX-xLog Prototype.app`. The existing `/Applications/OM0RX-xLog.app`, xCat and xCluster bundles were not replaced. This is not a notarized production release and contains no personal logbook or live station provider.

Suggested operator test:

1. Open **OM0RX-xLog Prototype**, select a synthetic DX Cluster spot, and check its call/frequency and band-map labels.
2. Log a synthetic QSO and check the cluster's opportunity label updates from new/unworked to worked. Session data is memory-only and resets on restart.
3. Open the detached monitor, move/resize it, and check the map and readable layout.
4. Run **Check integration contracts** and report any layout, interaction or classification issues. It exercises simulated contracts, not the real radio.

Windows/Linux P2 builds and desktop acceptance remain deferred until this Mac preview has been tested. The single shared implementation and previous P1 portability evidence are retained.

## Delivered scope

This is the next bounded integration increment, not completion of the full xCat/xCluster migration or gate G2. It retains the shared React/Tauri shell and portable Swift core proven in P1. The working native macOS release and installed apps are unchanged. The user deferred consumer Windows testing; that remains open and is not replaced by CI.

- `XClusterIntegrationCore`: actual xCluster spot parser, mode/band inference, ranking and classification rules adapted into a Foundation-only module, with an in-memory contact index. No SQLite reader, cluster socket, settings migration or personal logbook is opened. [Source provenance and deliberate changes](P2_CLUSTER_PROVENANCE.md).
- `XStationIntegrationCore`: independent radio/rotor/accessory/cluster selections; versioned Codable profile/context/command contracts; full-function capability declarations; a provider interface; deterministic observed-state tune lifecycle. ACK is not success. Exact fresh frequency/mode and requested RX/TX ownership must be observed. Profile/session changes, stale/out-of-order frames, supersession, deadlines, disconnect and shutdown are covered. [Contract and provenance](P2_STATION_CONTRACT.md).
- Bounded native worker IPC adds `cluster_classify` and `integration_self_test`. Both are pure operations; no command, connection, credential or filesystem method is exposed. The Rust allowlist and Swift envelope/parameter checks remain in place.
- The native prototype's DX Cluster and band-map labels now come from the extracted Swift rules and current synthetic session QSOs. Classification updates after logging. Superseded asynchronous responses are ignored; failed classification displays unavailable/unknown with a retry action, not invented results. Browser-only preview retains explicitly labelled fixture values.
- Complete synthetic history is capped at 128 QSOs before logging, keeping the bounded IPC envelope usable without dropping older contacts and inventing new-call results. At capacity the draft and all existing contacts remain intact. Map colours remain explicitly labelled fixture colours; cluster status and band-map colour follow native classification.
- Native acceptance now requires 17 observed checks, including contract diagnostics and the ATNO → WKD transition after a synthetic QSO. Existing map pixel, keyboard, profile and detached-window gates remain required.

## Local validation

| Check | Result |
| --- | --- |
| Portable Swift suite | 55 passed: 26 cluster, 17 station, 12 worker/core tests |
| Frontend | 28 passed, including bounded complete history, rendered late-response and retry tests; TypeScript/Vite build passed |
| Rust | 9 passed |
| Actual worker process | 3 passed, including P2 integration requests, open-stdin framing and malformed-input recovery |
| Original Mac application | 43 tests / 7 suites passed; no app replacement |
| Ad-hoc Mac prototype | Exact source above rebuilt; strict bundle/worker signature verification passed; final native acceptance passed all 17 checks |
| Three-platform CI / runtime | Deferred by operator; initial matrix cancelled; P1 results are not claimed as P2 acceptance |

Total automated prototype tests on this Mac: **95 passed** (55 Swift + 28 frontend + 9 Rust + 3 process), separately from the 43 original-app tests and 17 native UI checks. Final native report: `docs/evidence/p2-macos-3ff72c5/native-ui.json`. All map probes matched (initial 88/88, before monitor 74/74, final 72/72, detached monitor 58/58). Six station-contract scenarios and cluster diagnostics passed with `station_io=false`.

Installed preview executable SHA-256: `16ed57235dd4cbf2f94b8bda3c0fe929ffd9890aae99b40a5cd8150d53b806d7`.
Installed worker SHA-256: `4c69344513da05ec321bc69481bd8df9c796b8bd484307c9089551a92a8e3de1`.

Tests use no live radio, amplifier, tuner, rotor, Wavelog, credential store or personal logbook. Station tests include a mock provider and actual coordinator transitions, not hardware acceptance. Production transmit features are represented in contracts; absence of a live provider in this prototype is not a new restriction on the working apps.

## Preservation and canonical ownership

xCluster extraction baseline is clean `776b7b04ffa5a9057f1e909339393549a103836b`. xCat is inspected at `b8f2e95527425247623dae366f94114bc0e1e94e` plus its pre-existing uncommitted diff, SHA-256 `fad2daaa7eacb924962ec8d0f6c1dad7eaa7993a170cc0b88d2cb731982a5939`. That work is not overwritten, bundled wholesale, committed on its owner's behalf, or described as a published release. Provenance records which behavior informed the new contracts.

The extracted modules are the integration branch's canonical domain implementation. The standalone apps stay frozen/preserved for current operation; they do not yet consume these modules. Before cutover, reconcile any later standalone fixes and migrate imports with golden tests. Do not maintain independently evolving rules in both products indefinitely.

## Remaining integration gates

- Persistent provider/process owner, real xCat/remote-agent and Hamlib transports, reconnect and credential-vault adapters.
- Extract remaining AppModel use cases and data/platform services; durable profiles and validated three-app migration/rollback.
- Integrated cluster network/console, full filter/settings/aggregation/index features, country/reference resolution, spots forwarding and coherent selection-to-radio pipeline.
- Complete CAT/CLU inventory and cross-platform parity, physical-device acceptance and operator-authorized cutover.
- Consumer desktop/DPI/GPU checks, supported-OS decisions, production signing/notarization, dependency redistribution review and release/update gates.

These remain explicit work, not inferred from a passing domain test or simulation. No Windows station policy, service, settings, ports or credentials were modified.
