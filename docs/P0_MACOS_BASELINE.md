# P0 macOS preservation baseline

Audit date: 2026-10-12, Australia/Darwin. This is evidence for preservation during the authorized P1 prototype, not completion of G0/G1 or certification of every current feature. The project plan, revision 2, was read before the audit; its CAT/CLU and PAR inventories remain the parity contract.

No installed app was quit, launched, replaced, moved or removed. No credentials, preferences, live logbook, station configuration or hardware endpoint was read or changed. Test/build output used separate scratch paths. The only repository write made by this audit is this report.

## Source baseline before prototype edits

| Repository | HEAD | Branch and state |
| --- | --- | --- |
| OM0RX-xLog | `4377d91697724fcd8bb345509aff5caa8fb6559e` | `codex/unified-xlog-prototype-p1`, clean before implementation |
| OM0RX-xCat | `b8f2e95527425247623dae366f94114bc0e1e94e` | `main`, 11 existing modified tracked paths |
| OM0RX-xCluster | `776b7b04ffa5a9057f1e909339393549a103836b` | `main`, clean |

xLog's unmodified `Package.swift` SHA-256 was `bd81f24142a441d31a65fb587d0b08b6e7a0f4927dc6ea5bb12414417e3f3ec8`. Its normal application manifest specifies Swift tools 5.10, macOS 13+, XLogCore and the native XLogApp. XCat specifies Swift tools 6.0/macOS 14+; XCluster specifies Swift tools 5.10/macOS 13+.

xCat's `git diff --binary` SHA-256 was `fad2daaa7eacb924962ec8d0f6c1dad7eaa7993a170cc0b88d2cb731982a5939`, unchanged after the tests. Existing changes comprise 460 insertions and 15 deletions across these paths:

- `Sources/OM0RXXCatApp/AppModel.swift`
- `Sources/XCatCore/Models.swift`
- `Sources/XCatCore/RemoteAgentClient.swift`
- `Sources/XCatCore/RemoteAgentModels.swift`
- `Sources/XCatCore/RigCtlCommandProcessor.swift`
- `Sources/XCatCore/Rotator.swift`
- `Sources/XCatCore/TCPCommandServer.swift`
- `Tests/XCatCoreTests/CATCommandProcessorTests.swift`
- `Tests/XCatCoreTests/RemoteAgentTests.swift`
- `Tests/XCatCoreTests/RigCtlCommandProcessorTests.swift`
- `Tests/XCatCoreTests/RotatorTests.swift`

The private diff itself is not copied into this report. These changes remain owned by the existing development session; passing tests do not reconcile or publish them. xCluster remained clean after its tests. Source SHAs do not establish the source revision of installed executables.

## Installed applications

Metadata was read from each installed Info.plist. All three executable signatures report thin arm64, hardened runtime and Developer ID Application: Oliver Bross, team `4WCMQ4U946`.

| Installed bundle | Version/build | Bundle ID | Minimum OS | Strict signature | Stapled ticket |
| --- | --- | --- | --- | --- | --- |
| `/Applications/OM0RX-xLog.app` | 0.3.0 / 6 | `com.oliverbross.OM0RXXLog` | 13.0 | Valid | `stapler validate` passed |
| `/Applications/OM0RX-xCat.app` | 0.5.1 / 14 | `com.oliverbross.OM0RXXCat` | 14.0 | Valid | No ticket stapled; validation did not pass |
| `/Applications/OM0RX-xCluster.app` | 0.1.6 / 7 | `com.oliverbross.OM0RXXCluster` | 13.0 | Valid | No ticket stapled; validation did not pass |

Strict verification used `codesign --verify --deep --strict --verbose=2`; each bundle was valid on disk and satisfied its designated requirement. Missing stapled tickets on xCat/xCluster are not proof of either notarization or lack of notarization. Gatekeeper assessment and live application launch were not repeated.

Installed executable SHA-256 values, identical before and after the baseline tests:

| Executable | SHA-256 |
| --- | --- |
| xLog `Contents/MacOS/om0rx-xlog` | `7a2b244545c9eb2639cde5f0a152c9cfaf40e2e06fde9ad97fd3184e37efdb97` |
| xCat `Contents/MacOS/OM0RX-xCat` | `d94ccbc39db39256d8204e72253191b94f059f547f8c3a867039999ad303b1cc` |
| xCluster `Contents/MacOS/om0rx-xcluster` | `db23f4179298c7dd30ac58a2740d89e1d9f9072d986f59341b3b30fa6747e68c` |

These hashes cover executables, not whole-bundle archives. They identify preservation references; they do not prove behavior or equality to a downloaded release archive.

## Published xLog v0.3.0

The GitHub API and local tag both resolve `v0.3.0` to commit `325c59a538564c373c6169a718a73780d7455546`. At inspection, the release title was `OM0RX-xLog 0.3.0`, published at `2026-10-12T01:46:00Z`, with `isDraft=false` and `isPrerelease=false`.

Release: https://github.com/oliverbross/OM0RX-xLog/releases/tag/v0.3.0

- Asset: `OM0RX-xLog-0.3.0-macOS.zip`, 3,199,293 bytes, state `uploaded`.
- GitHub-reported SHA-256: `a2977cf790adf909f340a9fa8a028ca6f90d31315f06cbb702f7e6c4abd7245e`.
- The release body describes the native macOS awards-library release and says its downloadable app is signed, notarized and stapled.
- `PROJECT_STATUS.md` records accepted notary submission `49b9cfbb-756a-4c13-86dd-f58ab61f02e0`, stapling/Gatekeeper success and the same archive checksum. That is existing release evidence, not a fresh notarization submission by this audit.

The archive was not downloaded, extracted or launched here. Its digest is API metadata, not a newly computed local digest. The source baseline is newer than the release tag; the installed app and release archive remain distinct evidence.

Suggested public description: **“v0.3.0 — current working macOS-only stable release.”** Explain that “stable” identifies the current published Mac reference while the separate unified prototype is developed; it does not claim all listed features or external workflows are certified. Keep tag, version and downloadable artifact unchanged when clarifying the title/documentation.

## Fresh baseline tests

Tests ran on the existing arm64 Mac with Apple Swift 6.4 (`swiftlang-6.4.0.34.1`, clang `2100.3.34.1`); Swift target reported `arm64-apple-macosx27.0.0`, testing target `arm64e-apple-macos14.0`, Testing Library `2084`. Exact host marketing OS/version was not established: `sw_vers` is permanently blocked by the lean-ctx allowlist. No allowlist changes or command rerouting occurred.

| Checkout | Command | Actual results | Exit |
| --- | --- | --- | --- |
| xLog, unmodified baseline | `swift test --scratch-path /tmp/om0rx-xlog-p0-20261012-baseline` | Swift Testing: 43 passed, 0 failed, 0 skipped; 7 suites, 0.407 s | 0 |
| xCat, HEAD plus preserved dirty changes | `swift test --scratch-path /tmp/om0rx-xcat-p0-20261012-baseline` | Swift Testing: 58 passed, 0 failed, 0 skipped; 8 suites, 2.111 s | 0 |
| xCluster, clean baseline | `swift test --scratch-path /tmp/om0rx-xcluster-p0-20261012-baseline` | XCTest: 22 passed, 0 failed, 0 skipped; 4 test suites, 0.184 s aggregate | 0 |

xLog's suites: OM0RX-xLog core, Transmit power capture, FLEX spot forwarding, Operating support, Operator intelligence, International award catalogue and Reference data updater. xCat's suites: SmartLink authentication, Flex command response parser, SmartLink broker parser, RigCtl command processor, CAT command processor, HF propagation conditions, RUMlog FLEX spots and Remote Station Agent. xCluster's suites: LogbookIndexTests (1), SpotLogicTests (19), SpotSnapshotTests (1), XLogCompatibilityTests (1).

The empty XCTest harness in xLog/xCat and empty Swift Testing harness in xCluster are not counted as additional passes. No skipped-test indication appeared. Test logs were inspected beyond compressed summaries to confirm real executed counts. Local lean-ctx logs have 24-hour retention; the observed aggregate results are recorded here. The xLog baseline completed before prototype Package.swift changes were released to the implementing agent.

These are current source test results. They do not establish release-build, clean-machine, UI, account, Windows/Linux, real-radio or physical-rotor acceptance.

## Requirements and remaining acceptance

The shipped xLog remains a native macOS 13+ SwiftUI/AppKit/MapKit application. Live tuning/frequency/mode currently require xCat; its installed version requires macOS 14+. Wavelog synchronization needs API v2 credentials, full QRZ lookup an eligible XML subscription, and official Club Log CTY downloads an application key. Local logging works without those integrations. These requirements are read from current README/package documentation, not exercised account connections.

Preserve current `PROJECT_STATUS.md` distinctions, including:

- Live bidirectional Wavelog edits/deletions, catalog refresh, operator-approved backup/restore drill and a second clean Mac remain acceptance work.
- Tune correctness/latency and cross-band/rapid-selection matrices are partial; recorded historical live samples are not new tests from this audit.
- Physical rotor comparison, live station actions/interlocks, FLEX marker display and several map/sidebar/responsive workflows retain their documented partial/external acceptance.
- Dedicated contest, satellite/manual split workflows and regional band-plan configuration remain backlog items.
- The worldwide library has 192 entries but only nine native executable award calculators; research/tracking/blocked/historical entries do not become qualifications, and local progress is not sponsor credit.
- Full WCA/castle directory ingestion remains blocked by the authoritative source documented in project status; pass-through values remain preserved. The source endpoint was not retested here.
- No Windows/Linux artifact, local Hamlib device support, integrated xCat/xCluster replacement, clean-machine runtime packaging or cross-platform visual parity is established by this baseline.

New baseline screenshots, interaction recordings, scale/accessibility matrices, sanitized parity fixtures and named physical test-device selection remain P0 work. Existing screenshots/status records are historical references and are not relabelled as fresh acceptance. Keep current installed apps and their data in place until the explicit later cutover gate; the documented prior Trash-triggered profile cleanup incident makes app removal unsuitable for prototype staging.

## Audit restrictions and preservation result

`PlistBuddy` and `sw_vers` received permanent lean-ctx allowlist blocks; those commands were not retried or rerouted. Info.plist contents were read as files with ordinary allowed reads. Signature/hash tests then used allowed independent commands. One release lookup used an incorrect repository owner and failed; it was corrected to the source remote's `oliverbross/OM0RX-xLog` repository.

All three installed executable hashes remained identical after tests. xCat's existing diff hash and changed path list remained identical, and xCluster remained clean. Prototype implementation changes in the authorized xLog feature branch are separate from this audit. No source, application, account or station changes are made by this report.
