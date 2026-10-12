# Mac live integration — 0.4.0-alpha.1

This is the shared Tauri/React application, not a replacement native SwiftUI
application. The existing macOS v0.3.0 release remains the stable product.
Branch: `codex/unified-xlog-integration-p2`.

**Latest operator acceptance:** see [the 2026-10-12 live report](P2_LIVE_ACCEPTANCE_2026-10-12.md).
Direct-agent connection, frequency change/restore and bidirectional rotor feedback
were subsequently verified. At the operator's explicit request, older local xLog
app bundles were moved recoverably to Trash and only Integration remains running;
the original data and published stable release are preserved.

## Preservation contract

- Separate bundle: `/Applications/OM0RX-xLog Integration.app`.
- Separate bundle identifier: `com.oliverbross.xlog.integration`.
- The native xLog, xCat, xCluster and previous Prototype bundles are retained.
- First-run **Copy my existing xLog logbook** opens the original SQLite file
  read-only and uses SQLite backup for a consistent copy including WAL records.
  It verifies and atomically publishes a private independent workspace.
- Workspace: `~/Library/Application Support/OM0RX-xLog-Integrated Preview/`.
- No automatic synchronization on the copy. Existing pending/outbox records are
  retained. Explicit Wavelog sync can write remotely; stop other writers first.
- Credentials are not copied or logged. Service credentials use the workspace's
  separate Keychain identity. Remote-agent credentials are entered only in the
  application's password field and stored by endpoint in a separate service.
- Restore affects only the isolated workspace, requires confirmation and creates
  a recovery package. Symlink/overlap/hardlink guards reject unsafe targets.

## Real paths implemented

The runtime entry point is `LiveApp.tsx`. It does not load fixture contacts,
fixture spots, or invented telemetry when a service is unavailable. The older
synthetic `App.tsx` remains solely for historic prototype regression tests.

| Area | Implementation | Acceptance boundary |
|---|---|---|
| Logbook | Persistent SQLite CRUD, delete/undo, paged search, full-field records, ADIF import/export | Independent copy; not a migration of the original writer |
| Reference data | Native CTY/LoTW/activation/catalogue services and isolated caches | Refresh requires an explicit action; sources may update independently |
| Awards | Existing native calculations and 192-entry source registry | Local progress is not sponsor-issued credit |
| Wavelog / QRZ / weather | Actual native clients, private credentials, manual sync/conflict/outbox UI | Account acceptance requires credentials; no silent remote writes |
| Cluster | Persistent TCP/Telnet, multiple servers, bounded framing, reconnect, all filter dimensions, classification against the isolated logbook, history, presets and console | An explicit connection is required |
| Station companion | Real loopback xCat observations and observed-target tune confirmation | Preserves current running station owner |
| Station direct | Embedded xCat RemoteAgent HTTPS/WSS client, endpoint credentials, radio/KPA/KAT/configuration controls | Stop standalone xCat before taking direct writer ownership |
| Rotor | Embedded direct DCU-1 TCP client and explicit goto/stop | Actual movement requires operator acceptance |
| FLEX spots | Opt-in filtered/deduplicated direct-agent forwarding | Agent acknowledgement is not visual Maestro confirmation |
| UI | Shared operator desk, cluster, logbook, maps, awards, sync/settings and station controls | Mac first; same shared UI source remains the cross-platform target |

## Lifecycle and command evidence

The desktop host maintains one persistent bounded NDJSON worker session rather
than restarting the worker for every poll. The Swift input reader does not block
the main actor, allowing subscribed network status to continue while stdin is
idle. A lost response is reported as an unknown outcome, never automatically
replayed as a station-control command.

Only fresh, authoritative frequency/mode and required RX/TX ownership can confirm
a tune. Provider/selection generations reject obsolete replies. Remote socket
callbacks and cluster callbacks are scoped to their connection generation.

The separate monitor is read-only, including a host-level method restriction.
It cannot tune by clicking its map or overwrite the main window's QSO draft.
On normal exit the worker gets a bounded graceful EOF window. It concurrently
attempts to release only PTT/CW/tune controls this session attempted to activate,
including uncertain acknowledgements. Read-only disconnect sends no control
commands. A crash, network outage, or forced termination cannot guarantee a
hardware release; the agent/radio protections remain essential.

## Operator setup

1. Launch **OM0RX-xLog Integration**. Choose the verified-copy option to use the
   existing logbook without changing it.
2. **Station Control → Existing xCat** reads the running companion immediately.
   This is the preservation path while the original apps remain running.
3. To test embedded ownership later, stop the standalone xCat connection, choose
   **Direct agent**, enter the HTTPS endpoint and paste the token directly in the
   application. Do not paste credentials into a chat or terminal.
4. Configure **DX Cluster** with an appropriate separate login while the original
   cluster app is still connected. Save then Connect. FLEX forwarding is off until
   explicitly enabled and requires the direct provider.
5. Review **Settings** and credentials; do not synchronize the copied logbook
   alongside another active Wavelog writer.
6. Use **Monitor** in the main toolbar for a normal, non-always-on-top window.

## Open parity and release gates — not 100% complete

The shared application now has real services; this does **not** establish full
native feature parity or production-release readiness. Remaining work includes:

- Full native map/band-map presentation parity (multi-band detached workspaces,
  allocation lanes, collision-free labels, DXCC overlay and rotor path).
- Full native awards search/filter and sponsor-evidence presentation parity.
- Original xCluster RUMlog `.rlog` source/Automation compatibility handoff.
- Original xCat local FLEX/SmartLink and CAT-server interoperability surfaces,
  rotor presets/automatic tracking and the complete station-monitor presentation.
- Local Hamlib radio/rotor profiles and live Windows/Linux service transport.
- Direct-agent token provisioning, observed tune/supersession,
  rotor motion and Maestro colour/display acceptance with the operator.
- Wavelog/QRZ/reference-provider credentialed acceptance and original-vs-copy
  writer cutover. No real QSO should be fabricated for a test.
- Developer ID signing/notarization and clean-machine release qualification.

The development bundle is ad-hoc signed. It must not be presented as the signed,
notarized stable release or as uniformly accepted on Windows/Linux.

## Verification

Local checks on 2026-10-12: **174 passed, zero failed** in the final runs:

- Original/native xLog Swift suite: 49.
- Shared Mac Swift suite: 77 (17 station contracts, 19 worker/station XCTest,
  33 cluster XCTest, 8 isolated-logbook Swift Testing).
- Frontend: 35.
- Rust desktop host: 10.
- Worker-process framing/correlation: 3, also run against the installed bundle.

An earlier full run exposed out-of-order cluster transport callbacks. The live
service now serializes callback delivery before entering its actor; the complete
suite subsequently passed. An installed first-run failure in Foundation's
UserDefaults suite was replaced with a private explicit cluster configuration
file. First-run logbook onboarding no longer depends on cluster startup success.

Native installed-app checks loaded a verified **67,843-contact** copy, displayed
actual paged rows, found an existing callsign through search, and rendered nine
native award calculators plus all **192** registry entries. No QSO was added,
edited, deleted or remotely synchronized during acceptance. The original app
executables retained their exact baseline SHA-256 hashes; the original xCat
dirty diff retained hash `fad2daaa7eacb924962ec8d0f6c1dad7eaa7993a170cc0b88d2cb731982a5939`.

**Initial live radio acceptance was blocked upstream:** the already installed standalone xCat
showed HTTP 502, reconnecting, and an interrupted Remote Agent WebSocket. The new
app's companion path correctly did not invent radio data. Windows service recovery
was required before live radio/tune/rotor/spot acceptance. No Windows policy, MOX,
amplifier or radio command was changed by this work. A separate cluster login was
requested from the operator rather than taking over the existing live session.

After the operator restarted Windows, standalone xCat showed Connected, VFO A
18.160 MHz USB, VFO B 18.088 MHz CW, KPA STBY, KAT ANT1 and clear alarms.
The original xCat loopback listener still resets the integration app's status
connections, so this does not establish embedded-client acceptance. See
`WINDOWS_AGENT_RECOVERY_FOR_XLOG.md` for the recovery handoff and chronology.

The operator approved the separate **OM0RX-13** cluster login. The installed shared
app connected to ShackCQ, received the server's explicit OM0RX-13 greeting and
real incoming spots, and displayed callsign/DXCC classifications against all
67,843 copied contacts. OM0RX-12 was left untouched. FLEX forwarding remained off;
no received spot was clicked to tune or move the antenna.

The final local bundle was rebuilt and installed from `b9744fd91b8eddcbf8481eb3674423d2a776836c`.
Strict ad-hoc signature verification and all three installed worker-process tests
passed. The clean GitHub build originally selected Swift 5.10; its workflow now
uses the same Xcode 16.2 toolchain as the passing native build, without changing
the copied xCat source or the macOS 14 deployment target.

Both clean GitHub workflows passed on that SHA: native CI run `38218696048` and
shared application run `38218696064`, including the uploaded Mac application
artifact. The installed compact two-column monitor rendered successfully as a
normal window, with unknown station values clearly unavailable and real cluster
spots plotted on its map. This is display validation, not rotor-motion evidence.

Published Apple Silicon archive:
`OM0RX-xLog-Integration-0.4.0-alpha.1-macOS-arm64.zip`.
SHA-256: `e50195ebe4cd39f8ed80c9a709516f41f950bdc5fc51590202443b5b6e3428a9`.
It includes the separate app, setup notes, GPL notice and resolved dependency
license inventory. This development package is not notarized.

Unit fixtures are not hardware evidence. UI screenshots remain in the task rather
than Git because they contain private logbook rows. No tokens, personal database
files or local settings are published.
