# Unified xLog: xCat, xCluster, local stations and cross-platform programme

Planning revision: 4 · 2026-10-12 · Owner: Oliver Bross, OM0RX

Implementation update: the user authorized the next integration stage while deferring consumer Windows testing. [P2a foundation](P2_INTEGRATION_ACCEPTANCE.md) implements shared station contracts and portable xCluster domain rules with native-worker/UI wiring on `codex/unified-xlog-integration-p2`. G2 remains partial until the remaining use-case/platform-service extraction and real-provider ownership are proven; no live cutover is implied.

Status: **P0 preservation complete; P1 isolated prototype passes 39 tests per OS, runtime packaging and native synthetic UI acceptance on macOS, Windows and Linux. G1 remains conditional on consumer-desktop and platform-release acceptance**.
The user authorized P0/P1 after revision 2. See [preservation manifest](P0_MACOS_BASELINE.md), [prototype](../prototype/README.md) and [acceptance ledger](P1_PROTOTYPE_ACCEPTANCE.md). This remains the complete programme plan, not a claim of released Windows/Linux support or hardware acceptance. Installed applications, station configuration, credentials and live logbooks remain unchanged. Later phases are not silently marked complete by the synthetic prototype.

The authorized packaging follow-up is recorded in [P1 runtime acceptance](P1_RUNTIME_ACCEPTANCE.md), including exact binaries, hashes, native loader evidence and test downloads. Windows portable ZIP and Ubuntu Debian/archive runtime dependencies are packaged; fresh native runs pass two Windows and four Linux launches without a Swift toolchain. Windows consumer-desktop, physical Linux GPU/Wayland, signing/notarization, final redistribution review and real-provider/data migration remain separate gates. The user's remote station PC has not been used or modified by this work.

## 1. Executive decision

All three requested outcomes are achievable:

1. **Standalone operation:** xLog can manage a local radio and rotator through bundled Hamlib helpers, with no xCat, Windows agent or cloud account required. Existing remote operation remains a selectable station profile. Radio and rotor connections must be independently selectable, allowing mixed local/remote stations.
2. **One cross-platform product:** one shared interface, one domain implementation and one release version can serve macOS, Windows and Linux. Each OS still needs its own built/signed package, device integration and acceptance tests. Those are platform adapters, not three different applications.
3. **Integrated station suite:** xCat's control/monitor/settings features and xCluster's complete cluster workspace become modules within xLog. Users launch and install only xLog; they do not need either standalone Mac app. The Windows Remote Station Agent remains the service beside the remote hardware, not an extra desktop requirement for local operation.

**There is no honest “recompile the existing app unchanged” route.** The current UI depends on SwiftUI, AppKit and MapKit. Swift itself supports Windows and Linux, but that does not make those Apple frameworks portable. We can preserve the design, workflows, data, algorithms, protocol knowledge and tests; the interface implementation and OS-specific plumbing need migration.

Recommended direction, conditional on the early prototype gate:

- Tauri 2 desktop shell with one TypeScript/React interface and shared design tokens.
- Retain and make portable the existing Swift domain core in a bundled headless worker; do not immediately rewrite proven logbook, ADIF, Wavelog reconciliation or award calculations.
- Keep Rust shell code narrow: window lifecycle, credential access, supervised child processes and bounded IPC. Do not implement competing business rules in Rust or JavaScript.
- Hamlib `rigctld` and `rotctld` as bundled, supervised local helpers; optional connection to an operator-managed daemon.
- A provider-neutral station model serving existing xCat compatibility, direct authenticated Windows-agent connectivity, local Hamlib and disconnected/manual operation.
- Built-in Station Control and DX Cluster workspaces, with shared settings, credentials, activity history, selected-spot workflow and an undockable station monitor. Optional compatibility endpoints serve existing external CAT clients.
- MapLibre GL JS for the shared map, subject to cartography licensing, performance and accessibility acceptance.

This is a **controlled UI/platform migration**, not a fresh redesign or a requirement to rewrite everything. The Swift-worker choice must prove packaging, Foundation networking/XML, SQLite, cryptography and process lifecycle on all three platforms before the bulk migration. If it fails its time-box, approve an explicit alternative ADR; do not silently maintain two domain engines.

## 2. Scope and non-goals

### Required outcomes

- Local USB/serial or supported network radio and rotator configured entirely in xLog.
- Full supported control, not an artificially receive-only product: tuning, mode, VFO/split, RIT/XIT, power, PTT/CW/tune where the selected hardware/backend genuinely supports them and the operator enables/configures them.
- Preserve remote FLEX/Maestro, KPA500/KAT500, rotor, acknowledged spots and existing station-policy behaviour.
- No mandatory KPA/KAT/FLEX or OM0RX-specific callsign, Wavelog server, gridsquare or port for a new user.
- Same application-drawn layouts, colour meanings, readable typography, keyboard workflows and detached workspaces on all supported systems.
- Existing local logbook, unknown ADIF fields, backups, sync identity, outbox, conflicts and awards evidence remain intact.
- Normal users install one application, not Homebrew, a compiler, Swift, Hamlib or a terminal setup procedure.

### Explicit non-goals

- Replacing remote station policy with a generic Hamlib implementation; remote safety/route decisions stay at the station.
- Rebuilding the Windows station agent or xBridge. The xCat/xCluster **desktop functionality is now in scope** for integration, but their standalone applications need not be independently rewritten for three OSes. Preserve old releases during migration; any later standalone distribution must be a thin shell over shared modules, not a second implementation.
- Promising all Hamlib models expose identical capabilities or that CAT provides audio, a waterfall, digital-mode decoding or FLEX panadapter spots.
- Adding every unimplemented award calculator, contest engine, satellite tracker, mobile app or web service as part of portability. Existing research-only awards stay research-only.
- Requiring identical OS titlebars, file pickers or font rasterisation. Those differ by platform; app content and behaviour must remain consistent.
- Connecting to hardware, moving a rotor, transmitting or changing the working remote station during planning.

## 3. Verified baseline and coupling audit

Inspected repository: `oliverbross/OM0RX-xLog`, clean `main`, local and remote SHA `325c59a538564c373c6169a718a73780d7455546`, release documentation `v0.3.0`.
The inspected Swift source totals 11,836 lines (including application orchestration and views, excluding tests/resources); this is scope evidence, not an effort formula.

| Area | Current evidence | Portability/local-operation consequence |
| --- | --- | --- |
| Build | `Package.swift`: macOS 13+, Swift tools 5.10; XLogCore and XLogApp | Portable core target must stop linking Apple frameworks unconditionally. |
| Views | `Sources/XLogApp/*.swift`: SwiftUI/AppKit, MapKit in `PropagationViews.swift` | Reimplement view layer once; preserve interaction specifications and visual baseline. |
| Orchestration | `AppModel.swift`: 1,756 lines; UI state, timers, station actions, draft edits, lookup and sync coordination | Extract use cases/state machines from UI rather than translating a monolith into React. |
| Radio | `XCatClient.swift`: Darwin sockets, IPv4, default loopback `14532` | Introduce portable transport and provider interface, preserving existing xCat settings. |
| Custom station protocol | `get_xcat_state`, `xcat_action`, `xcat_tune`; observed-simplex confirmation | These are xCat extensions, **not generic Hamlib commands**. A host/port setting alone cannot make xLog a generic Hamlib client. |
| TCP handling | Current command function opens a socket per request and uses a single `recv` | New transport needs incremental framing, partial-write handling, cancellation and bounded parsing. This inspection is not proof of a current live fault. |
| Rotor | Automatic turn checks `XCatStationSnapshot` and station `allowedActions` | Separate rotor capability/state from accessory policy so a standalone rotor works without a KPA/KAT. |
| Propagation | Included in the combined xCat station snapshot; weather/solar core already exists | Extract/reuse propagation fetching independently; xCat cannot be the only source in standalone mode. |
| Cluster | `ClusterSpotFeed.swift` reads `OM0RX-xCluster/spots.json` | Preserve compatible snapshot import but add an integrated cluster source so other OSes do not require a Mac app. |
| FLEX spots | `FlexSpotForwarder.swift`: Darwin UDP to loopback `12062` | Retain bridge adapter; direct remote provider needs agent acknowledgement handling. UDP send success is not radio acceptance. |
| Storage | `LogbookDatabase.swift`: SQLite WAL, JSON QSO records, conflicts and outbox | Keep schema/identities first; platform-neutral SQLite bindings and verified backups. |
| Credentials | `SecretStore.swift`: Apple Security/Keychain | OS vault abstraction; never credentials in portable settings or frontend persistence. |
| Settings | `Settings.swift`: UserDefaults, OM0RX/xCat/Wavelog defaults | Versioned station profiles; neutral onboarding for new users; migrate existing users without resetting preferences. |
| Recovery | `BackupManager.swift`: SQLite backup API, CryptoKit, Foundation | Verify compatible hash/archive behaviour; preserve backup format and restore semantics. |
| References/awards | Bundled CTY, DXCC geometry, nine native rule packs, 192-entry research-aware library | Reuse licensed data/tests; preserve live/tracking/blocked/historical distinctions. |
| Distribution | Shell packaging/notarization; CI only `macos-14` | Three OS build lanes, sidecar dependencies, Windows signing and Linux packaging required. |

Source-of-truth files: [Package.swift](../Package.swift), [PRODUCT.md](../PRODUCT.md), [DESIGN.md](../DESIGN.md), [project status](../PROJECT_STATUS.md), [award coverage](AWARDS_COVERAGE.md), [XCatClient](../Sources/XLogCore/XCatClient.swift), [AppModel](../Sources/XLogApp/AppModel.swift), [settings](../Sources/XLogCore/Settings.swift), [CI](../.github/workflows/ci.yml).

The existing xCat repository also contains `RemoteAgentClient`, `RemoteAgentModels`, `Rotator` and `PropagationConditions` modules. These are reuse candidates, not a reason to require the xCat application. Audit their licences, dependencies and tests before extraction; pin shared-package revisions rather than copying diverging files.

### Expanded integration baseline

The user's follow-up makes complete xCat and xCluster integration part of this programme, not an optional later enhancement. README and source-file inventories were inspected for both apps:

- xCat local HEAD: `b8f2e95527425247623dae366f94114bc0e1e94e`. **This checkout contains existing uncommitted changes** in radio/remote/CAT/rotor code and tests. They are not incorporated, overwritten, committed or presumed deployed by this plan. G0 must reconcile these with the responsible development session before choosing the integration baseline.
- xCluster local HEAD: `776b7b04ffa5a9057f1e909339393549a103836b`, clean at inspection. These are local provenance observations, not independent verification of remote branch tips or runtime SHAs.
- xCat modules include SmartLink authentication/broker/TLS, direct FLEX, remote-agent transport/configuration, CAT and RigCtlD servers/processors, spot bridge/rules, rotor and propagation. xCluster modules include ClusterHub, SpotLogic, LogbookIndex, settings/colours, snapshot export and xLog/RUMlog handoffs.
- Source references: [xCat README](https://github.com/oliverbross/OM0RX-xCat/blob/b8f2e95527425247623dae366f94114bc0e1e94e/README.md), [xCluster README](https://github.com/oliverbross/OM0RX-xCluster/blob/776b7b04ffa5a9057f1e909339393549a103836b/README.md). Inventory is based on source/documentation, not a new runtime test of every advertised feature.

The 11,836-line xLog count above excludes the added suite scope. Do not use the original xLog-only size as an estimate of the integrated product.

## 3A. xCat and xCluster integration contract

### One operator workflow

The primary navigation becomes Operator Desk, Logbook, DX Cluster, Maps/Band Maps, Insights, Station Control, Activity/Sync and Settings. Preserve the existing desk; additional workspaces must not make its sidebar illegibly small or scroll essential live controls out of view. Station Control contains connection, radio, accessory, rotor, spot-forwarding and diagnostics views. Settings is one configuration authority with clear provider-specific sections.

Cluster selection → one selected-spot use case → preserve/fill the QSO draft → request radio tuning and optional rotor movement → show observed results. Maps, cluster rows, callsign context and station monitor consume that same selection and state. They must not each independently tune the radio or clear the callsign.

The floating station monitor stays a normal movable/resizable window, launched visibly from xLog. Persist position without forcing always-on-top; monitor contents share the main app state. Do not add a second mandatory menu-bar app. Closing a monitor window does not shut down the station session; quitting xLog has an explicit helper/TX/rotor lifecycle.

### Features that must be accounted for

| Integration ID | Existing capability to retain inside xLog | Design / acceptance requirement |
| --- | --- | --- |
| CAT-01 | Direct local FLEX, native SmartLink and Remote Station Agent modes | Independent providers; strict radio-serial/station selection, no silent fallback to another radio; platform/authentication tests |
| CAT-02 | SmartLink login, broker discovery, WAN TLS, refresh token and radio-certificate pin | Preserve validation and account scoping; no disabling TLS verification to make a port work; live provider acceptance separate |
| CAT-03 | Dual VFO RX/TX roles, split, mode/frequency and supported CAT control | Shared observed-state model and command queue; full supported functionality with truthful readback |
| CAT-04 | Remote KPA/KAT, per-band policy/configuration, commissioning, route, alarms and actions | Integrated station settings use agent contract/version validation; preserve all remote configuration until explicit edits |
| CAT-05 | Station monitor with rotor/map, propagation and accessory metrics | Same readable design and detached-window behaviour, no second state cache |
| CAT-06 | RUMlog-compatible UDP Logbook/Contest spots, priorities, colours and lifetimes | Configurable input; one deduplication/forwarding authority; matching FLEX acknowledgement, no loop |
| CAT-07 | Local TCP CAT TS-480 and RigCtlD servers for external clients | Optional loopback listeners, existing configurable ports/command coverage, bounded input and shared controller ownership |
| CAT-08 | Direct DCU-1 TCP rotor, callsign/grid targeting, band offsets, bidirectional antenna and UDP targets | Extract proven rotor logic; do not force existing ARCO setup through Hamlib or Windows |
| CAT-09 | Reconnect/heartbeat/staleness/activity and shutdown behaviour | Transport health distinct from radio readiness; live timing/recovery evidence |
| CAT-10 | Simulator and supervised legacy-xCAT compatibility | Preserve simulator for testing; audit legacy dependency per OS, explicitly approve any compatibility exception |
| CLU-01 | Multiple cluster connections, login/passwords, auto-reconnect and RBN/Skimmer requests | Built-in service and per-server state; user-configured identity and servers rather than an OM0RX-only default |
| CLU-02 | One/all-server command console, presets and responses | Clear command target; console data is untrusted text; no accidental duplicate commands |
| CLU-03 | Full dense spot table and call/DXCC classifications | Preserve source, spotter, comments, worked-before date, score and special tags, not just band-map markers |
| CLU-04 | Multi-select filters, text search, sort, limits, hide-worked, configurable palettes | One normalized filtered/classified collection drives table and maps; retain NC/NB/NM/ATNO semantics |
| CLU-05 | Special-station multi-match rules and reference extraction | Preserve precedence, regex/input bounds and recognised ADIF references; no invented reference IDs |
| CLU-06 | Previous-QSO evidence, LoTW arrows and country-wide band/mode matrix | Use central xLog read projections; immediate refresh after save/edit/delete/sync without polling another app's database |
| CLU-07 | xLog/RUMlog source and tune-target compatibility, URL/snapshot handoff | Internal xLog route becomes default; optional exports remain compatible; no write access to live RUMlog database |
| CLU-08 | Settings/password/colour/filter migration | One-time imported copies with preview/provenance; no overwrite of standalone settings until owner accepts cutover |

CAT/CLU rows are mandatory scope-tracking entries; every one needs implementation evidence or an owner-approved compatibility exception before “fully integrated” is claimed. RUMlogNG/AppleScript automation and legacy executables have platform-specific availability. Preserve applicable Mac integration, make unavailable external-app features clear elsewhere, and do not claim Windows/Linux can run RUMlogNG. The core xLog workflow must have no such dependency.

### Consolidation without duplicated ownership

- Extract XCatCore and XClusterCore behaviours into modules within the xLog repository or a single versioned shared package selected at G1. Preserve provenance/licences and import their test suites. No independent copies with separate fixes.
- Replace internal loopback CAT/UDP/file handoffs between the three modules with typed service calls/events. Keep protocol adapters only for external applications and staged migration. The integrated app must not CAT-connect to itself through its compatibility port.
- One radio session and one rotor session own each device; UI, CAT clients and cluster actions submit to the same arbitration layer. Background telemetry does not fight human VFO changes. Profile switches also invalidate commands from old external-client sessions.
- One logbook writer/sync authority; cluster classification consumes a shared index/query API. Distinguish exact-call, entity, band and mode credit; invalidate incrementally when log data changes. Do not introduce a second logbook or independently poll a stale SQLite copy.
- One spot stream/classifier and one FLEX forwarder. Define deduplication IDs, source provenance, TTL, selected filters and loop-prevention tags for UDP/cluster inputs. Reconnecting must not republish every expired marker.
- One settings/vault facade imports xLog/xCat/xCluster preferences and credential references; prompt if same port/device/profile name has conflicting settings. Never write secret migration material to a file or stdout.
- When enabling integrated listeners, detect running xCat/xCluster services and explain conflicts. Offer an explicit handover; do not silently kill them, steal ports or open duplicate hardware sessions.
- The Windows agent remains the existing remote authority. Integration changes its desktop client, not its serial policy, Tailscale settings or installed service by default.

Until G7, current standalone apps remain recoverable references. After acceptance, xLog is the primary distribution. Do not delete their repositories, local edits or user settings as a side effect of consolidation; archival/retirement is an explicit later decision.

### Evidence limits

- This planning pass inspected source, documentation and upstream primary documentation. It did not rerun tests, build a portable prototype or test any radio.
- Existing release test counts are historical baseline evidence, not new passes from this task.
- Windows/Linux distribution, Swift-worker portability, real-device Hamlib behaviour and map equivalence remain unproven.
- Existing `PRODUCT.md` mandates xCat ownership. An implementation ADR must explicitly supersede that rule for local providers, while retaining exactly one owner of each physical device. The rule is not silently changed by this proposal.

## 4. Product experience: profiles, not separate editions

### Profile presets

| Preset | Radio | Rotor | Accessories | Typical user |
| --- | --- | --- | --- | --- |
| Local station | Managed Hamlib | Managed Hamlib or direct supported controller | None unless configured | USB radio and rotor at the desk |
| Existing OM0RX station (transition) | Existing xCat bridge on Mac | xCat or independent local rotor | xCat station service | Preserve today's working configuration until integrated handover |
| Remote station | Authenticated HTTPS/WebSocket agent | Independent local/network rotor, or supported provider | Same agent | Australia operator, Slovakia RF site; all three OSes |
| Advanced/mixed | External rigctld or chosen provider | Independent rotctld/controller | Optional | Shared CAT setup, remote radio/local rotor |
| Logbook only | None/manual | None | None | Offline logging/import/research |

The existing xCat compatibility mode alone does **not** establish Windows/Linux remote parity: xCat is presently a Mac app. The integrated xCat module's direct Remote Station Agent provider is a release dependency for that parity. Its API contract and station policy remain unchanged unless a separately agreed API gap requires coordinated work. Direct FLEX and SmartLink are separate integrated modes, not automatically equivalent to generic Hamlib.

### Configuration and workflow

Settings gains a Station Profiles section with General, Radio, Rotor, Accessories and Diagnostics pages. A compact profile switcher is visible on the operator desk; detailed settings need not clutter the sidebar.

Each profile contains a stable ID, station callsign, **physical RF-site grid**, operator identity/location separately, Wavelog station mapping, radio/rotor providers and endpoints, validated device options, reconnection policy and capability preferences. Reference credentials by vault ID. Never infer the antenna's location from the laptop's location: the Australia/Slovakia case must calculate bearings from Slovakia.

Radio setup: searchable manufacturer/model list, model/backend maturity, serial device or host, baud/framing/flow-control/CI-V where applicable, separate PTT configuration where supported, polling limits, connect/reconnect and an understandable diagnostic result. Persist stable USB identity where available; device path alone is not durable after unplug/replug. Do not autodetect by spraying write commands at ports. Opening a port can toggle RTS/DTR, and some backends initialise hardware: audit those effects before a wizard labels any connection test “read-only”.

Rotor setup: model, serial/network transport, baud, true-north calibration, azimuth range/overlap, elevation if supported, cable-wrap limits, park heading, antenna/band offsets, presets, manual click-to-turn, stop and automatic callsign/grid following. Differentiate reported heading from target; interpolate display smoothly without claiming the antenna moved before telemetry confirms it. Grid/coordinates outrank CTY country-centre approximations, which must be labelled as estimates. Handle north crossing, poles and near-antipodal bearing ambiguity.

Automatic turning is a persistent **per-profile** operator choice, clearly visible with a stop/disable control. Do not enable physical movement just by importing a profile. Debounce callsign entry and enrichment, discard superseded targets and never replay an old turn after reconnection.

No-accessory stations hide KPA/KAT-specific controls rather than showing red disconnection warnings. Missing optional hardware is “not configured”, not a broken station. Unsupported capabilities explain why; temporarily stale data is distinct from unsupported data. The same component renders every profile, avoiding a separate local UI fork.

### Switching profiles safely

1. Preserve the active QSO/draft and show any different station identity; do not silently relabel a contact already in progress.
2. Stop new command admission, cancel queued work and automatic rotor following; identify outstanding actions and TX/motion status.
3. Do not switch in the middle of active TX or uncertain command completion without explicit recovery. Never key a radio to test a profile. An xLog-owned TX session needs its defined release/stop path; never promise a crash can unkey hardware without a hardware watchdog.
4. Close only owned helpers/connections, release devices, increment session generation, then open the new profile.
5. Obtain observed state; discard every callback from the previous generation. Restore auto-follow only under the selected profile's explicit setting and a fresh target, not stale queued commands.
6. If connection fails, retain the draft and manual logging; offer reconnect or explicit switch-back. Do not reconnect to the old station silently.

## 5. Shared architecture and ownership

```text
One xLog UI: TypeScript / React / design tokens / maps
                       |
             typed, bounded local IPC
                       |
Tauri shell: windows + vault + process supervision (thin Rust)
                       |
Shared Swift worker: logbook + sync + awards + integrated cluster/control
     |                 |                   |                 |
 xCat adapter     Remote-agent adapter   Hamlib adapters   Manual provider
 Mac optional     HTTPS + WebSocket      rigctld/rotctld   no hardware
                       |                   |
                Existing Windows       Local serial/TCP
                station authority      radio and rotor
```

Radio, rotor, accessory, cluster and propagation providers are independent services underneath the shared use cases; the diagram groups them only for readability. The integrated control module also contains direct FLEX and SmartLink adapters, and optional incoming CAT/RigCtlD/UDP compatibility servers. Hardware IO never runs on the rendering thread. Logbook/sync failures must not block a priority rotor stop or TX-release request; use separate actors/queues, bounded IO and independent supervised hardware helpers.

### Contracts to specify before implementation

| Contract | Required responsibilities |
| --- | --- |
| RadioProvider | Connect/disconnect, observed snapshots, capability discovery, supported commands, coherent RX/TX VFO state, timestamps and errors |
| RotorProvider | Reported/target heading, motion/limits, goto/stop/park, elevation when supported; separate from radio health |
| AccessoryProvider | Optional amplifier/tuner telemetry and allowed actions; no fabricated KPA/KAT defaults |
| StationSession | One owner per device, profile generation, command ordering, cancellation, freshness and request correlation |
| ClusterProvider | Integrated DX-cluster input plus optional existing file/URL handoff; normalized spots, filtering, deduplication and backpressure |
| PropagationProvider | Independent fetching/cache/age/source; graphical display survives failed refreshes |
| SpotDisplayProvider | Optional FLEX marker delivery with matching acknowledgement; unsupported on ordinary CAT radios |
| Logbook/Sync services | Single database writer and reconciliation authority; UI receives projections rather than owning persistence |
| PlatformServices | Vault, serial inventory, application paths, dialogs, URL activation, notifications, power/resume and process lifecycle |

Snapshots carry profile ID, session generation, sequence, per-field observation age/quality, connection state and source; absent/unknown does not mean zero or RX. Keep raw radio mode/submode separate from ADIF mode. Generic DIG/DATA must not automatically become FT8. Preserve receive and transmit VFO/frequency/mode independently.

Commands carry request ID, intended profile/device, parameters, deadline and capability requirement. Return distinct `accepted`, `observed`, `rejected`, `timed_out` and `outcome_unknown` states. An acknowledgement is not proof of movement, completed route reconciliation or a radio state change. Idempotency and retry are command-specific; never replay a physical write merely because a connection dropped.

IPC uses versioned bounded messages and inherited pipes, not an unauthenticated public HTTP server. Stdout is protocol-only; diagnostics use a separate redacted channel. Validate message lengths, types, frequencies, ranges, enums and allowed operations on the privileged side. The frontend cannot choose arbitrary executables, shell commands or filesystem paths. Establish maximum queue depth and cancellation semantics in the prototype. Generate transport types from one schema; do not share an entire mutable application-state object.

### Reuse strategy

- **Retain with portability work:** Swift models, ADIF handling, semantic identity, sync rules, awards, CTY/geography, reference validation and backup semantics. Foundation-only does not automatically mean portable; verify imports/runtime behaviour.
- **Extract then reuse:** AppModel's draft lifecycle, spot selection, enrichment precedence, rotor targeting and command-result reconciliation.
- **Replace once:** SwiftUI/AppKit views, MapKit rendering, Darwin transport, platform paths/secret storage and native lifecycle glue.
- **Reuse data under its existing notices:** icons, CTY/GeoJSON and award references; audit each asset's redistribution terms.
- **Preserve as compatibility adapters:** xCat custom protocol, xCluster snapshot and URL scheme, existing backup format.
- **Do not create duplicate engines:** no separate TypeScript awards calculator, Rust sync engine or Windows-specific logger while Swift remains the domain authority.

## 6. Framework decision record (provisional)

The following is an engineering assessment, not benchmark evidence. Gate G1 decides the stack using the actual operator desk, maps, detached windows, keyboard workflow and worker package.

| Option | Reuse and consistency | Material cost/risk | Decision |
| --- | --- | --- | --- |
| Keep SwiftUI; add native Windows/Linux views | Can retain some Swift domain logic | Three UI implementations and repeated feature work; fails user's maintenance goal | Reject as destination |
| Tauri 2 + shared web UI + portable Swift worker | Preserves domain logic; strong fit for dense tables/maps and shared tokens | Three toolchains; WebView differences; worker/runtime packaging must be proven | Preferred prototype |
| Tauri 2 + Rust domain core | Same shared UI, fewer runtime languages | Rewrites tested persistence/sync/award logic; data regression risk | Fallback only if Swift portability gate fails |
| Flutter desktop + shared core boundary | Shared drawn UI; supported desktop targets | UI rewrite still required; maps, detached windows and plugin parity need proof; Dart domain port adds more rewrite | Credible alternative, not a parallel implementation |
| Qt 6 / QML + C++ or Swift worker | Mature desktop/device ecosystem, shared drawn controls | New UI and integration layer; module licence/build review and map choice | Fallback if desktop WebView gate fails |
| Electron + same web UI/worker | Bundled Chromium reduces engine variance | Larger runtime and ongoing Chromium/Node security/update burden | Fallback if Tauri engine variance cannot meet parity |

Swift officially supports Windows and Linux tooling [S5]. Tauri uses different system WebViews on Windows, macOS and Linux [S6]; therefore “same CSS” alone is not visual acceptance. Flutter desktop support [S9] and Qt Quick/platform documentation [S10] show alternatives are feasible, not that our app ports without work. Electron bundles Chromium/Node [S11].

G1 should test the preferred option first, not build four full prototypes. If a blocking issue remains after 5–8 engineer-days, document it with a minimal reproduction and costed fallback. If Swift-worker portability fails, compare a targeted Rust domain migration with the real blocker; do not spend weeks writing undocumented runtime shims. A fallback changes the estimate and requires owner approval.

## 7. Hamlib integration plan

### Version and supply chain

As checked on 2026-10-12, upstream's latest stable release is **4.7.2**, released 2026-06-21 [S1, S2]. Candidate source archive SHA-256: `ae1fcf2dbc80ea0786ea8f047b09399c3f7737d1930442f61a031708ed33e88f` [S1]. Recheck at implementation kickoff, pin the chosen release/commit/checksums, and record patches and enabled backends per architecture. Do not float production packages to nightly builds or whatever happens to be installed on the host.

The release notes list security fixes, including GHSA-f72v-7gmh-m9mj. Its advisory metadata still reports no patched version [S2, S3]; reconcile the selected source's fixes and regression coverage rather than treating a version number or stale advisory field as proof. Bundle approved binaries built from traceable source, licence notices, source/build information and an SBOM. Do not copy Hamlib from another installed application.

### Managed and external modes

- Default simple local mode: xLog launches bundled helpers itself, binds explicitly to loopback and gives the user a Connect button. Each physical device has one owner. Rig and rotor processes are independently supervised.
- Operator-managed mode: connect to an existing rigctld/rotctld; do not kill, reconfigure or claim ownership of that daemon.
- Enumerate models/capabilities from the **shipped version**; label backend maturity. Do not promise supported features from a brand name alone.
- Pick collision-free loopback ports and validate which process owns them. Preserve xCat's existing `14532`; Hamlib conventional defaults are `4532`/`4533` [S4]. Do not take over a service already listening there.
- Treat raw Hamlib TCP as trusted-local/VPN transport, not an Internet-secure station service. No router port forwarding, no default `0.0.0.0`, and no daemon password presented as a substitute for encryption/authenticated remote control. Loopback restricts network exposure but does not authenticate other local processes.
- Restart owned helpers with capped backoff; do not repeatedly open ports or toggle serial control lines on failure. Observe fresh state after recovery; do not restore the last TX, tune or rotor command automatically.

### Protocol and feature behaviour

Use the documented extended-response framing where supported and prove the selected version's exact dialect [S4]. Maintain command/response association across fragmented/coalesced TCP reads, disconnects and errors. Bound response size and time; serialize operations per device and coalesce redundant reads. Never assume the xCat extensions exist on a generic Hamlib server.

Start with bounded frequency/mode polling, then enable only supported optional fields. Add VFO/split reads without swapping VFOs as an unadvertised polling side effect. Honour backend timing and avoid piling up requests against slow serial radios. Rigctld sharing has protocol/VFO-mode caveats: use one agreed dialect and owner; do not launch multiple daemons against the same serial port to solve a client mismatch.

Capability levels: supported, unavailable, unverified and temporarily failed. Cover frequency, raw mode/passband, RX/TX VFO, split, RIT/XIT, RF drive, meters, PTT, CW, tune and antenna selection individually. Convert normalized power to watts only with defensible model/band calibration; otherwise show the native unit. Do not invent output power from configured drive. Hamlib does not substitute for FLEX panadapter spots or KPA/KAT route coordination.

Radio+mode updates are not necessarily atomic on generic hardware. Keep a coherent published snapshot, preserve the active callsign, and distinguish pending intent from observed state. On a partially applied change, re-read/report the actual result; do not blindly roll back to a previous frequency. An older poll or spot selection must never overwrite a newer selection.

Full operator functionality remains the goal. Backend limitations and genuine hardware interlocks still matter; this is not permission to delete station protections or label unverified controls functional. Development starts with fake/dummy hardware, progresses to authorised non-transmitting device tests, and only then to explicitly supervised TX tests where those features are in scope. Software tests cannot prove RF behaviour.

## 8. Visual and functional parity contract

Preserve [DESIGN.md](../DESIGN.md)'s navy surfaces, cyan radio information, teal healthy states, amber attention, orange worked, coral error and pink references. Keep the current screens and information hierarchy. Replacing a framework is not approval for a visual redesign.

Freeze baseline screenshots and interaction recordings at the accepted minimum window size, a standard desktop size, a tall detached band-map window and a dual-monitor layout. Include 100%, 150% and 200% scale, text enlargement, reduced motion, keyboard-only use and relevant screen readers. Choose a redistributable cross-platform font pair with owner-approved comparison; Apple's system font must not simply be bundled for other OSes. Allow native window chrome/dialog differences, not missing controls or unreadable substitutions.

The sidebar must stay readable and avoid becoming a vertically scrolling control wall. Use adaptive grouping/collapse and a documented minimum useful size, while preserving access to secondary settings. Do not hide essential controls to meet a screenshot. Long logbooks, awards and configuration lists may scroll intentionally.

| Parity ID | Capability | Required evidence |
| --- | --- | --- |
| PAR-01 | Operator desk, compact/full QSO editor, shortcuts and tab order | Side-by-side screenshots and scripted keyboard workflows on all OSes |
| PAR-02 | Logbook create/edit/delete/search; unknown ADIF preservation | Same fixtures/semantic results and crash/restart recovery |
| PAR-03 | Wavelog v2 bidirectional sync, deletion, conflicts and retries | Contract server plus separately authorised account acceptance; no duplicate uploads |
| PAR-04 | QRZ/manual-field precedence, CTY, LoTW and activation references | Out-of-order replies, cache/validator/offline fixtures and credential errors |
| PAR-05 | All existing award calculators, library delivery states and achievements | Golden outputs; research tracking never promoted to certification |
| PAR-06 | Cluster feed, classifications, opportunity labels and band maps | Integrated source and compatibility source produce equivalent spot behaviour |
| PAR-07 | World map, DXCC/spot overlays, short/long paths, detached maps | Antimeridian/polar tests, attribution, multiwindow/scale/GPU tests |
| PAR-08 | Radio tuning/follow, coherent split/VFO, reconnect | Fake-provider transcripts plus representative physical-model matrix |
| PAR-09 | Rotor display/click/auto/stop/limits and presets | Simulator trajectories then observed physical motion with operator approval |
| PAR-10 | KPA/KAT telemetry/actions and station route status | Existing remote contract; no accessory requirement for local profile |
| PAR-11 | Acknowledged FLEX spot forwarding and colour/lifetime mapping | Matching command acknowledgement plus operator-visible Maestro proof |
| PAR-12 | Propagation/weather, graphical stability, source age | Refresh/failure/recovery tests; no text/graphic flicker |
| PAR-13 | Backup/import/restore, OS vault, portable settings | Restore drill and redacted diagnostic inspection per OS |
| PAR-14 | Reconnect, profile switching, detached monitor and launch | Sleep/resume, crash, app restart, multi-monitor restoration and URL activation |
| PAR-15 | Full xCat integration, including local FLEX/SmartLink and external-client compatibility | Every CAT-01…10 row verified or explicitly excepted; no standalone xCat process needed |
| PAR-16 | Full xCluster workspace/console/classification/preferences | Every CLU-01…08 row verified or explicitly excepted; no standalone xCluster process needed |

MapLibre supplies the renderer, not free satellite imagery or unlimited tiles [S12]. Select a licensed provider or permitted offline dataset, preserve visible attribution, document tile limits/cost/privacy and validate cache terms. Do not scrape Apple MapKit tiles or promise identical Apple imagery. Agree on equivalent Standard/Satellite/Hybrid layers; make any unavoidable cartographic difference explicit before approving parity. Maps may fail offline, but local logging, cached geography and device control must continue.

## 9. Data, credentials and upgrade strategy

1. Keep the current SQLite schema initially. Create versioned migrations only when profiles/portable settings require them; never use ADIF export/import as the only migration, because sync state and identities would be lost.
2. Capture a consistent SQLite backup including WAL state through the backup API, plus settings, draft/workspace state and reference data. Hash/validate the recovery package; restore into a disposable location and compare records before touching production data.
3. Preserve local UUIDs, Wavelog IDs/station mappings, baselines, outbox retries, tombstones, conflicts, unknown fields, dates/time zones and confirmation evidence. Test old Swift JSON encodings, optional/default fields and non-ASCII text.
4. Prototype/beta uses a separate app ID and cloned database with sync **off**. Never run two sync authorities against the same live log. Validate a single-writer application lock for final installations.
5. Store portable non-secret profiles in a versioned schema. Existing macOS UserDefaults migrates once without replacing the operator's callsign, host, grid or preferences. New installs start neutral and ask for station identity.
6. macOS Keychain, Windows credential storage and Linux Secret Service are OS adapters. Preserve the old Mac service/account mapping where access permits. If an OS vault is unavailable, explain it and use session-only secrets; never silently fall back to plaintext. Account re-entry may be necessary when moving to another OS.
7. Never include bearer tokens, API keys, passwords, private log contents or full personal paths in telemetry, repository fixtures or handoffs. Diagnostics are opt-in/redacted; no public production-data uploads.
8. Cross-OS migration uses a verified portable backup, not a live SQLite database in Dropbox/SMB or simultaneous writers. Resolve platform paths independently.
9. Final cutover is reversible: stop old app/sync, create verified backup, migrate, validate counts/identities/outbox, then enable the new app. Old app cannot open an incompatible migrated DB. Rollback restores the pre-migration package or uses a separately tested reverse migration; account for any contacts synced after cutover before reverting.
10. Retire old bundles only after acceptance and retention approval. Do not move a working bundle into Trash if a cleanup utility may erase its support data; archive release artifacts separately and preserve user data/vault entries.

## 10. Work breakdown and delivery gates

Owners below are roles, not assignments to running agents: PL = product/technical lead, CORE = domain engineer, UI = interface engineer, IO = station integration engineer, QA = validation, REL = release engineer, OP = station operator. One person may fill multiple roles. Status for all implementation rows is **not started**.

| Work ID / phase | Deliverable and principal tasks | Dependencies | Owner | Exit gate | Effort range |
| --- | --- | --- | --- | --- | --- |
| P0 / Baseline | Inventory every current workflow; capture screenshots and sanitized fixtures; record build/test/resource baseline; approve parity and support matrix | Plan review | PL + QA | G0: owner accepts feature baseline and proposed OS scope | 2–3 days |
| P1 / Architecture spike | Shared desk slice, real map, detached window, keyboard flow; portable Swift worker with SQLite/ADIF/HTTP/XML/hash; Hamlib dummy helpers; packaged launch on all OSes | G0 | CORE + UI + REL | G1: stack accepted from measured prototype, or explicit fallback ADR | 5–8 days |
| P2 / Contracts and extraction | Provider interfaces, observed-state/command contract, profile schema, IPC schema; extract AppModel use cases; golden fixture corpus and platform services | G1 | CORE + IO | G2: old Mac workflows retain equivalent test results behind abstractions | 5–8 days |
| P3 / Local station vertical slice | Managed/external rigctld and rotctld, wizard, process ownership, reconnect, capability UI, local/remote profile switch | G2 | IO + UI + QA | G3: standalone radio+rotor workflow without xCat; fake tests and named physical-device acceptance distinguished | 8–12 days |
| P4 / Shared UI and domain parity | All original PAR screens/workflows, map replacement, independent cluster/propagation, direct remote adapter, migrated preferences, disconnected operation | G2; integrates G3 | UI + CORE + IO | G4: PAR-01…14 dispositioned on three OSes; no unexplained feature loss | 15–25 days |
| P4I / Full suite integration | Beyond the P4 basic providers: direct FLEX/SmartLink, CAT servers, UDP rules, full cluster table/console/settings, common index/selection, xCat/xCluster settings migration and imported tests | G2; shared contracts with P3/P4 | IO + CORE + UI | G4I: CAT/CLU inventory and PAR-15/16 dispositioned; no standalone apps required | 12–20 additional days |
| P5 / Migration and resilience | Verified backup/restore, credential migration, interrupted writes, sync conflict replay, sleep/hotplug and long soak | G3 + G4 + G4I | CORE + QA | G5: recovery drills pass; no lost/duplicated contacts or stale physical actions | 5–8 days |
| P6 / Release engineering | Signed/notarized Mac; signed Windows installer; Linux packages; bundled runtimes/Hamlib; clean-machine matrix; SBOM and docs | Packaging begins G1; final G5 | REL + QA | G6: exact artifacts verified on clean targets; signing evidence separate from hardware evidence | 4–7 days |
| P7 / Pilot and cutover | Parallel observation on cloned data, controlled migration of working Mac, Windows/Linux pilot users, regression fixes, retire duplicate UI only after acceptance | G6 | PL + QA + OP | G7: owner accepts parity and rollback; one maintained UI becomes canonical | 5–10 days |

Expanded range: **61–101 engineer-days before contingency**, roughly 12–20 full-time engineering weeks for one engineer, plus external waiting and a 20–30% contingency allowance. The earlier local/portable-only scope was 49–81 days; full xCat/xCluster integration adds an estimated 12–20 days without double-counting the basic providers already in P4. This is a planning estimate, not a quote or delivery promise; a core-language rewrite, wider SmartLink/platform work or unavailable hardware changes it materially. Two engineers can overlap work after contracts stabilise, but shared-state/debugging/release gates do not scale linearly. Re-estimate after G1 and G3.

Critical path: `G0 → G1 → G2 → G3/G4/G4I → G5 → G6 → G7`.
Packaging/security research begins at P1, not after UI completion. Map/provider integration and local Hamlib can proceed independently after G2 under separate file ownership and contract tests. Do not let two development sessions modify the Windows station implementation and the Mac transport contract independently without a shared versioned handoff.

### First approved implementation sprint (not executed by this document)

- Freeze the current release as the reference, create a `codex/` feature branch, and keep the existing Mac app installed and operational.
- Create a sanitized parity fixture pack and baseline screenshots; identify exact local radio/rotor models available for later tests.
- Build only the P1 vertical slice, with dummy devices and a copied database. Test launch without developer toolchains installed.
- Record elapsed effort, rendering/memory results, dependency size, platform failures and packaging steps.
- Decide the stack at G1, then update PRODUCT/DESIGN architectural wording and approve P2–P4. Do not quietly implement the whole rewrite before this decision.

### Backlog detail / traceability

| ID | Implementation item | Acceptance reference |
| --- | --- | --- |
| LOC-01 | Neutral onboarding and migration of existing OM0RX profile | Existing settings unchanged; new user has no hardcoded account |
| LOC-02 | Separate radio/rotor/accessory capabilities and settings | Local rig+rotor works with accessories absent |
| LOC-03 | Hamlib pin/build/license manifest and model inventory | Exact helper hashes/models on each platform |
| LOC-04 | Device enumeration, serial options, connect-side-effect audit | Correct device survives reconnect; no uncontrolled port scan |
| LOC-05 | Managed helper lifecycle, external-daemon mode and ownership | Port collision, crash and exit cleanup tests |
| LOC-06 | Framed Hamlib protocol and coherent tuning | Fragmentation/partial failure/rapid supersession tests |
| LOC-07 | Rotor control, limits, calibration and auto-turn state | PAR-09 and operator-observed motion |
| LOC-08 | Profile transition and stale generation rejection | No old-profile callback changes current state |
| REM-01 | Preserve xCat custom protocol adapter | Existing fixture/live acceptance comparison |
| REM-02 | Direct remote-agent auth/state/actions/acknowledged spots | PAR-08/10/11 without a local xCat dependency |
| REM-03 | Local rotor with remote radio | Bearings use RF grid and no Windows rotor proxy |
| CP-01 | Portable core build and platform adapters | Three native CI toolchains and packaged-worker launch |
| CP-02 | Typed bounded IPC and single writer | Invalid/oversized messages, crash and lock tests |
| CP-03 | Shared visual tokens, components and accessible shortcuts | PAR-01 plus visual review |
| CP-04 | Portable map and independent detached windows | PAR-07/14 and licensed layer manifest |
| CP-05 | Direct cluster provider plus compatible xCluster input | PAR-06; no external Mac dependency on other OSes |
| CP-06 | Independent propagation/weather fetching | PAR-12 offline/recovery tests |
| INT-01 | Reconcile xCat dirty worktree and pin suite provenance; import eligible modules/tests | G0/G2; no unrelated edits overwritten |
| INT-02 | Integrated control workspace, direct FLEX/SmartLink, compatibility servers and spots rules | CAT-01…10 / G4I |
| INT-03 | Integrated cluster table, console, settings, index and selected-spot pipeline | CLU-01…08 / G4I |
| INT-04 | Three-app settings/vault/workspace migration and port/device handover | PAR-13/15/16; no duplicate sessions |
| DATA-01 | Portable backups, profile/preferences and secret migration | PAR-02/03/13, verified restore drill |
| REL-01 | Reproducible bundles, signing and update lifecycle | G6 exact-artifact evidence |
| CUT-01 | Beta, cutover and legacy retirement | G7; one domain/UI implementation remains |

## 11. Test and performance programme

### CI and fixtures

- Run existing xLog, xCat and xCluster Swift tests first and retain exact per-suite counts/baseline SHAs; migrate golden fixtures before changing their implementations. Add portable-core lanes on Windows/Linux immediately at P1. Existing uncommitted xCat work must be reconciled before baseline tests are attributed to a published commit.
- Run shared frontend unit tests, IPC schema compatibility, provider contract tests, static/type checks, secret/dependency scanning and packaged-resource tests on every relevant change.
- Test compiled release helpers, not only mocks: Hamlib dummy radio/rotor plus transcript servers for fragmentation, unsolicited bytes, oversized messages, negative replies and delayed/lost acknowledgements.
- Test complete app installers on clean OS images without Xcode, Homebrew, Swift, Node, Rust or system Hamlib. Native OS runners are required; compiling on the Mac alone does not prove Windows/Linux.
- No job with zero executed steps counts as a pass. Record exact SHA, environment, test command, pass/fail/skip counts and artifact hash.

### Required failure scenarios

Rapid spot A→B→C; late A acknowledgement; stale pre-tune telemetry; knob tuning during pending commands; split-to-simplex transition; mode-only change; call enrichment finishing after the draft changed; dropped connection after a write; stalled serial read; USB unplug/re-enumeration; occupied port; external daemon restarted; worker/UI crash; profile switch during rotor movement/TX; sleep/resume; slow/failed QRZ/maps/weather; Wavelog conflict/delete/retry; backup during WAL writes; migration interrupted; missing/locked vault; duplicate instance; corrupted reference download; incompatible API/protocol version; simultaneous external CAT and UI requests; cluster reconnect floods; UDP spot loops; classification after log edits/deletions; SmartLink expired authentication/certificate mismatch; running old xCat during integrated listener startup.

Physical test coverage needs named devices/firmware/drivers, not “Hamlib supported”. Minimum proposal: two different radio backend families, one simple azimuth rotor, existing ARCO/DCU-1 compatibility, and the current remote FLEX/KPA/KAT station. Substitute only through a documented support-matrix change. Dummy devices do not establish real-device certification. Advanced unsupported controls are marked honestly rather than guessed.

### Performance targets (proposed budgets, not current results)

| Measurement | Acceptance target | How to distinguish causes |
| --- | --- | --- |
| Telemetry arrival → visible UI | p95 ≤100 ms, p99 ≤200 ms under representative desk load | Monotonic receive/apply/present timestamps; exclude upstream/network time |
| Local radio change → display | Target ≤500 ms p95 for agreed fast model; document slow-backend limits | Device transcript + poll completion + UI trace |
| Remote command/state | No material regression against measured baseline; separate WAN, agent and route-ready stages | Australia–Slovakia RTT is at least roughly 300 ms by operator report; do not promise 250 ms end-to-end |
| Rotor animation | Smooth frame-paced interpolation; no invented heading after stale data | Telemetry/target trace plus rendered capture and reduced-motion test |
| Logging | Durable save p95 ≤150 ms on agreed baseline machine; no main-thread stall >100 ms | Synthetic 100k-QSO fixture, controlled storage, monotonic timings |
| Logbook/awards/maps | Virtualized table; incremental/worker computation; interactive typing during refresh | 100k QSOs and 2k visible/queued synthetic spots; profile memory/CPU |
| Stability | ≥8-hour lab soak and ≥24-hour pilot session | No unexpected disconnect loops, lost drafts, growing queues or monotonic memory growth |

Freeze baseline machines/workloads at G0 and revisit budgets at G1; never trade away truthful readback to make a timing number. Set absolute memory/startup budgets from measured prototype results instead of promising a fabricated footprint.

## 12. Platform, distribution and security matrix

Proposed first supported targets, subject to G0/G1 dependency verification:

| Platform | Initial target | Required platform work |
| --- | --- | --- |
| macOS | Retain current macOS 13+ intent; arm64 and x86_64 eligibility verified in spike | Keychain compatibility, signed nested helpers/runtimes, hardened runtime/notarization, dock/menu/URL activation, serial drivers |
| Windows | Windows 11 x64; assess Windows 10 separately, no silent support promise | Credential vault, COM enumeration/driver guidance, signed installer/sidecars, WebView2 provisioning, DPI and process cleanup |
| Linux | Ubuntu 24.04 LTS x86_64 as initial reference; explicit X11 and Wayland coverage | Secret Service, serial group/udev guidance without running app as root, WebKitGTK/GPU dependencies, desktop/URL registration, package baseline |

Windows ARM64 and Linux ARM64 are follow-up targets unless the owner makes them launch requirements. “Linux support” does not mean every distribution/ABI is tested. Do not drop an existing supported Mac architecture/OS silently: if dependencies force a change, record the minimum and obtain a support decision before release.

One repository, one product version/changelog and one shared source commit; separate platform artifacts and build instructions. Use native runners, locked dependencies, traceable builds, published checksums and SBOMs. Mac remains signed/notarized; Windows Authenticode requires its own signing identity—Apple credentials do not cover it. Choose one primary Linux format plus a documented compatible fallback after testing runtime dependencies. Framework packaging support is not notarization or clean-machine proof [S8].

Restrict Tauri capabilities per window; untrusted spots, comments, ADIF and reference data render as text, never privileged HTML. Use a restrictive CSP and URL allowlists; remote map content never gains station-control IPC. Secrets remain outside the renderer and never enter URLs/logs. Verify updater signatures and hashes, stage updates outside active operation, and do not replace a hardware helper during TX/motion. Defer automatic updates until interruption/recovery semantics are proven. Maintain GPLv3 project obligations and audit every redistributed library, font, map and Hamlib component; process separation does not remove licence obligations.

## 13. Risks and decision register

| Risk / decision | Impact | Mitigation / owner / gate |
| --- | --- | --- |
| R1: Swift worker cannot package reliably on Windows/Linux | Core reuse assumption fails | Time-box portable real-feature slice; cost targeted alternative, PL/CORE at G1 |
| R2: WebView/GPU/font differences change maps or dense layout | User's visual parity requirement fails | Three-platform screenshots, licensed shared fonts, fallback ADR, UI/QA G1/G4 |
| R3: “Standalone” still depends on xCat/xCluster | Missing radio/rotor/spots/propagation on new OS | Explicit independent providers and unplugged-suite test, IO G3/G4 |
| R4: CAT/PTT/RTS/DTR or rotor limits differ per backend | Unintended physical action or unsupported feature | Model-specific capability/initialisation tests and operator gates, IO/OP G3 |
| R5: Database migration duplicates/deletes contacts or syncs twice | Loss of trusted logbook | Cloned beta DB, single writer/sync owner, verified rollback, CORE/QA G5 |
| R6: Third-party map imagery unavailable or costly | Visual/operational downgrade | Provider/licence/cost decision at G1; offline graceful fallback, PL |
| R7: Remote provider bypasses station policy or diverges from agent | Route/control regression | Existing versioned commands/allowed actions; exact SHA handoff, IO G4 |
| R8: Two UIs/cores remain indefinitely | Repeated feature implementation | Feature freeze and retirement gate; one canonical core from G2, PL G7 |
| R9: Endless compatibility/model scope | Schedule unbounded | Published launch matrix; extra devices/platforms become separate backlog, PL G0 |
| R10: Signing, clean hardware or vault access unavailable | Source works but release unproven | Start provisioning at G1; publish explicit blocked evidence, REL/OP G6 |
| R11: Security update or stale upstream docs | Vulnerable/unsupported helper | Pin source, inspect advisories, test exact shipped command set, REL each release |
| R12: Existing xCat working changes lost or baseline mistaken | Regression in already-developed station fixes | Reconcile dirty files with their owner; no blind reset/overwrite; pin tested commit, PL/IO G0 |
| R13: Suite integration duplicates controllers/spot streams | Conflicting tuning, duplicate markers or stale classifications | One session, shared index/selection and loop-safe adapters, CORE/IO G4I |

Open decisions, with proposed defaults:

- D1: approve preservation-first Tauri/Swift-worker spike, not immediate core rewrite (PL + owner, G0).
- D2: confirm target OS/architectures, minimum screen/text sizes and exact local radio/rotor models (owner, G0).
- D3: choose licensed font and cartography/imagery budget after side-by-side review (owner + UI, G1).
- D4: confirm which advanced PTT/CW/tune features are part of the first local supported-device matrix, with supervised acceptance arrangements (owner + IO, G2).
- D5: confirm Windows signing identity and clean Windows/Linux test machines (owner + REL, start G1).
- D6: choose release version at G6 based on delivered compatibility; do not publish a new app version for this planning document.

These decisions do not block creation of this plan. They gate the relevant implementation/release stage; no credentials or new purchases are requested now.

## 14. Change control, reporting and definition of done

Recommended temporary feature policy: accept data-loss/security/operating regressions and work needed for this programme; defer unrelated new features until G2 contracts are stable. Do not stop maintaining the currently working Mac release. Keep unfinished awards work explicitly in its existing backlog.

Use short `codex/` branches and small reviewable changes. Keep one canonical `main`, without platform forks. Merge only after the appropriate gate; maintain the existing SwiftUI shell temporarily as a compatibility/reference client, not as a second feature roadmap. New domain logic is implemented once. Do not remove the native shell until every required parity row is accepted or an explicit owner-approved exception exists.

Weekly/phase report template:

- Baseline/current SHA, branch, changed work IDs and gate status.
- What works in source, what packaged artifacts launched, and what hardware/account acceptance actually occurred.
- Exact tests passed/failed/skipped by suite and OS; links to logs/screenshots without credentials or private QSOs.
- Performance percentiles with trace boundaries, sample count and environment.
- Risks/blockers, decisions needed, effort used and revised remaining estimate.
- Next bounded stage and rollback point.

Per-work-item completion checklist: implementation linked; tests linked; docs updated; privacy/licence review where applicable; source/CI/package/hardware evidence separated; failure/recovery behaviour verified; owner acceptance when physical/UI decisions require it. A green unit test or dummy radio is not physical acceptance.

Programme completion means all of the following:

- [ ] One shared maintained interface and domain core ships on the agreed Mac, Windows and Linux matrix.
- [ ] Local rig and rotor operate with xCat/xCluster/Windows agent absent; logging remains usable without hardware or network.
- [ ] xCat and xCluster user-facing capabilities are integrated under CAT/CLU acceptance rows; one xLog install/settings system serves the complete workflow, with documented external-app exceptions only.
- [ ] Existing remote profile and direct remote-agent profile retain agreed parity, with station policy unchanged.
- [ ] All PAR rows have evidence or explicit accepted exceptions; missing features are not relabelled “complete”.
- [ ] Exact packaged artifacts pass clean-machine, data restore, credential and update/rollback checks.
- [ ] Full supported controls are tested at the appropriate simulator/device/operator level; no RF or motion claim exceeds evidence.
- [ ] Documentation contains local onboarding, profile switching, device limitations, OS permissions, troubleshooting and backup recovery.
- [ ] Working Mac cutover is accepted and reversible; no two apps can write/sync the same live logbook concurrently.
- [ ] Legacy duplicate UI is retired after the agreed pilot, with recoverable release artifacts and preserved user data.

## 15. Primary research sources

Checked 2026-10-12. Version/toolchain choices are revalidated at kickoff. Upstream documentation describes its own software; architecture, effort and acceptance recommendations above are this project's engineering judgments.

- **S1:** [Hamlib 4.7.2 release and source checksum](https://github.com/Hamlib/Hamlib/releases/tag/4.7.2).
- **S2:** [Hamlib official downloads and release notes](https://github.com/Hamlib/Hamlib/wiki/Download).
- **S3:** [Hamlib security advisory GHSA-f72v-7gmh-m9mj](https://github.com/Hamlib/Hamlib/security/advisories/GHSA-f72v-7gmh-m9mj).
- **S4:** [rigctld manual pinned to 4.7.2](https://github.com/Hamlib/Hamlib/blob/4.7.2/doc/man1/rigctld.1) and [rotctld manual pinned to 4.7.2](https://github.com/Hamlib/Hamlib/blob/4.7.2/doc/man1/rotctld.1). Snapshot manuals can describe unreleased functionality; test against the selected release.
- **S5:** [Swift platform support](https://www.swift.org/platform-support/).
- **S6:** [Tauri platform WebViews](https://v2.tauri.app/reference/webview-versions/) and [external binary packaging](https://v2.tauri.app/develop/sidecar/).
- **S7:** [Tauri security model](https://v2.tauri.app/security/) and [capability permissions](https://v2.tauri.app/security/capabilities/).
- **S8:** [Tauri distribution guidance](https://v2.tauri.app/distribute/).
- **S9:** [Flutter desktop support](https://docs.flutter.dev/platform-integration/desktop).
- **S10:** [Qt supported platforms](https://doc.qt.io/qt-6/supported-platforms.html) and [Qt Quick](https://doc.qt.io/qt-6/qtquick-index.html).
- **S11:** [Electron introduction](https://www.electronjs.org/docs/latest).
- **S12:** [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/).

## 16. Planning-task record

2026-10-12: reviewed the current xLog source/package/CI/design and key xCat integration points; verified xLog local/remote baseline SHA; checked primary Hamlib/framework documentation; wrote this proposed programme and linked it from README/project status. Revision 2 incorporates the user's additional requirement to integrate xCat and xCluster, adds the CAT/CLU feature inventory, records the dirty xCat checkout, and expands delivery gates/effort. No implementation, runtime configuration, radio action, application rebuild or release version change was performed. Implementation starts only after a new go-ahead, beginning with G0/P1 rather than treating this proposal as completed functionality.
