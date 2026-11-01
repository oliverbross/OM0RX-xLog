# OM0RX-xLog 1.4.5 Beta 1 acceptance

The [public beta](https://github.com/oliverbross/OM0RX-xLog/releases/tag/v1.4.5-beta.1) is pinned to application source [`27246b815bd9881e841f4f08bbed995a5dc7c33f`](https://github.com/oliverbross/OM0RX-xLog/tree/27246b815bd9881e841f4f08bbed995a5dc7c33f). All four installers use that source and version. The release is a prerelease and is not marked Latest. Its six attachments are the four installers, SHA256SUMS and curated PROVENANCE.json. GitHub's stored SHA-256 digests were compared with every staged attachment before publication and checked again afterward.

The [release notes](../releases/v1.4.5-beta.1.md) describe the logging, query and window performance changes; portable-station country correction; rotor preference and cancellation changes; spot forwarding; HM Control; cross-platform Wavelog client support; and station-setup, About and CW Alpha presentation changes.

## Exact-source automated checks

| Platform | Frontend | Native core | Rust: unit + integration + explicit bundled Hamlib |
| --- | --- | --- | --- |
| [macOS CI](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41315403829) | 5,013 tests, 355 files; 6 Node guards | 1,337 XCTest reported, 9 skipped, no failures; 605 SwiftTesting reported passed | 1,009 + 31 + 31 |
| [Linux CI and runtime](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41315826028) | 5,013 tests, 355 files | 916 XCTest reported, 7 skipped, no failures; 559 SwiftTesting tests | 1,006 + 31 + 31 |
| [Windows CI and runtime](https://github.com/oliverbross/OM0RX-xLog/actions/runs/41315616993) | 5,013 tests, 355 files; 6 Node guards | 918 XCTest reported, 7 skipped, no failures; 560 SwiftTesting tests | 993 + 31 + 31 |

Mac CI also passed 24 FLEX loopback tests and nine worker-framing tests. The Mac SwiftTesting summary has seven separately reported opt-in/live skip events; these are not subtracted from its reported count. Windows framing reported nine cases: six passed and three skipped. Native credential-store tests used disposable identities and cleanup; Linux checked both the C and Swift Secret Service paths.

Windows filesystem regressions cover durable replacement and exclusive publication, retained recorder-directory identity, before-write replacement guards, literal parent components, Unicode paths and fresh media-integrity verification. Overlapping recorder intervals share verification within one bounded response; subsequent responses check the media afresh. Playback and export keep independent verification.

## Native application and installer checks

The signed and notarized Mac app rendered content or explicit unavailable-service states in 24 feature windows. Marked disposable profiles exercised new-user setup, an existing profile without new settings fields, interrupted setup recovery, normal restart, and Normal Logging → Contest Setup → Normal Logging. Station identity and the draft survived restart and the module round trip. The CW Decode menu was hidden initially, enabled explicitly, retained across restart, then saved back to hidden. The Auto Rotor startup preference survived restart. About displayed the larger logo, version and requested author/contact details; HM Control displayed the linked synthetic station and log state.

A generated large-log fixture increased from 100,004 to 100,005 contacts after exactly one marked GUI save. The next logbook view and award count showed the new total. Read-only comparisons of private byte copies confirmed that every preceding stored QSO row and deletion state remained unchanged, with no synchronization outbox. The save/acknowledgement observation took 1,344 ms and the logbook-navigation/updated-row observation 1,307 ms. These include accessibility automation and are single bounded observations, not application-only timings or a latency guarantee. Cold startup retains a full database integrity check and is qualified separately from warm navigation.

Linux passed four fresh GUI launches with 36 checks each: three installed-package launches and one relocated-archive launch, covering X11 and nested Wayland. Windows passed four fresh WebView2 GUI launches with 36 checks each, without a Swift toolchain on the runtime runner. The EXE installed silently into a path containing spaces, relaunched the installed application, uninstalled successfully, and preserved a harness-owned user-profile marker. That marker test is not a claim that a real Windows operator logbook was exercised.

Linux and Windows shipping-runtime tests each discovered 97 contest catalogue entries and completed one synthetic CQ WW CW create/save/read/reopen/shutdown/cleanup round trip per invocation. Catalogue discovery is not 97 packaged contest round trips. The registered-contest developer-Python fixture cohort is a separate test scope.

The installed Mac replacement was checked against a private backup: original contact payloads and deletion states, integration settings, the saved draft including its timestamps, stored draft/base journals, and quarantined spot records were preserved. Backup and rollback copies remain private. No synthetic contact was logged into the operator's real logbook. Live service labels and Remote Station Agent spot acceptance were observed without tuning, transmitting or issuing test rotor moves.

## Distribution and privacy

The Mac application and DMG are Developer ID signed, Apple notarized and stapled. The Windows EXE is an unsigned beta. All installer-payload privacy audits reported zero findings; payload inventories and their hashes were checked. The resolved dependency inventories and bundled notices were retained; they are not a complete SBOM or a legal compliance certification. Public attachments contain application resources and curated provenance, without developer/operator profiles, logs, credentials, private diagnostic reports or screenshots.

| Installer | Bytes | SHA-256 |
| --- | ---: | --- |
| OM0RX-xLog-1.4.5-Beta-macOS-arm64.dmg | 136,055,236 | `4d9c3dcf4236c71bb4c78111a286961e47643ce566655a141f3f677d3b4500db` |
| OM0RX-xLog-1.4.5-windows-x86_64-setup.exe | 56,895,578 | `983fd10cb6b19746f29c064de2ee963be370590b9c42c1dc2f9f3bf4741b40da` |
| OM0RX-xLog-1.4.5-Beta-Linux-x64.deb | 60,420,186 | `722c83ed81f6e156e52d0f886099f02689fb00334c30d04ba1e6db5a7b6e498d` |
| OM0RX-xLog-1.4.5-Beta-Linux-x64.tar.gz | 80,335,281 | `257147fbc8f342d18c9fb4894813c0de622324bb16e4e5fe849fa3c2ff932fdf` |

## Qualification limits

Windows runtime acceptance used Windows Server 2022, not a separately qualified Windows 11 consumer desktop. Linux runtime acceptance used Ubuntu 24.04 amd64 with X11/Xvfb and nested Weston, not every distribution or compositor. Mac distribution targets Apple Silicon and macOS 14 or later; CI and local acceptance do not establish every supported machine configuration.

Offline service states, synthetic protocol fixtures and command acknowledgements do not prove physical radio/rotor behavior or Maestro marker display. Physical rotor movement, transmit behavior, provider-account coverage and CW decoder RF quality remain separate. CW Decode remains unfinished Alpha and hidden by default. No claim of zero latency or universal hardware compatibility is made.
