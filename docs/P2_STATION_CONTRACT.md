# P2 portable station contract

`XStationIntegrationCore` is a Foundation-only contract and deterministic observed-tune lifecycle.
It contains no concrete transport, socket, device discovery, credential lookup, server, retry write,
or hardware command implementation. `StationContractDiagnostics.run()` evaluates six simulated
scenarios through the actual state machine and returns a Codable report. Its `passed` property
derives from all scenario results. The report's evidence is `simulated-contract-only`.

## Schema and profiles

`StationProfile.currentSchemaVersion` is **1**. Codable profiles independently select optional
radio, optional rotor, up to 16 accessories, and optional cluster providers. No station, radio,
vendor, port, endpoint, or transmitter choice is a default. `ProviderSelection` identifies the
provider and optional device, endpoint, and opaque credential-store reference. It has no token
or password field. Endpoint validation rejects embedded user/password, queries, fragments,
unsupported schemes, invalid ports, and oversized values. References are handles, not secrets.

Consumers must call `validate()` after decoding profiles and commands; Codable decoding alone
does not authorize their use. `TuneCoordinator.activate` validates profiles and `begin` validates
tune targets automatically. Bounds here are structural limits, not a band plan or transmission
authorization. Providers must enforce their own frequency limits, safe-state interlocks and operator
authority. The broad 1 Hz through 1 THz frequency limit avoids encoding a specific radio's range.

## Provider boundary

`StationProvider` declares capabilities, connect, observation stream, typed execution, and disconnect.
`StationCommand` covers tuning, independent frequency/mode and RX/TX selection, split, PTT, CW,
RIT/XIT, RF power, station actions, rotor aim/stop, accessory control, and spot publication.
`requiredCapabilities` and `validate()` are available on every command. Capability declaration
for a tune additionally requires explicit RX/TX selection when ownership is requested, `split`
when TX frequency is requested, and `setMode` when a separate TX mode is requested. Capability
advertisement describes actual support; it grants no operator authority. A future provider must fail unsupported
operations explicitly. There is no generic fallback that sets simplex, chooses VFO A, substitutes
a sideband, sends PTT, retries a write, or infers missing ownership.

`ProviderContext` carries profile UUID, increasing owner generation, and a fresh session UUID.
The owner creates a new context on profile switch or reconnect. `activate` rejects non-increasing
generations and reuse of the current session UUID. All callbacks carry that exact context. The
owner serializes coordinator mutations; the coordinator is a Sendable value, not a socket owner.

`ObservedStationSnapshot` contains session/generation/profile context, sequence, source observation
time, readiness, authoritative flag, physical radio frequency/mode, explicit optional RX/TX ownership
and TX frequency/mode, and actual capabilities. Pending desired values must never be injected into
this snapshot. Missing values remain unknown. An adapter must reject unknown transport schemas
before mapping them, and must preserve genuine observation timestamps and replay order.

## Tune lifecycle

The owner supplies a finite monotonic clock shared with mapped observation timestamps; wall-clock
timestamps from remote radios require a documented conversion before use. Coordinator clock input
must never go backwards. The default freshness limit is 2 seconds (configurable >0 through 60),
and command timeout is >0 through 120 seconds (default 12). Future observation timestamps are rejected.

1. Activate a validated profile/context with declared capabilities.
2. Receive an authoritative, fresh, ready observation with valid physical radio frequency/mode.
3. Begin a validated `TuneTarget`; preserve optional ownership/TX requirements exactly as supplied.
4. Dispatch the returned `TuneRequest.commandRequest` through a future provider.
5. Feed acknowledgements and observations to the coordinator, and call `advance(now:)` for timeouts.

`begin` rejects missing, stale, disconnected, non-authoritative, or invalid baseline telemetry and
unsupported targets before a request can be dispatched. Unsupported attempts have bounded
`.unsupported` outcomes; invalid attempts do not supersede an already valid pending tune.
A valid new tune supersedes the preceding pending tune. ACK is only `.acknowledged`.

Confirmation requires a newer sequence than the command baseline, source observation time strictly
later than command issue, authoritative ready state within freshness age, matching physical frequency
and mode, and exact matching RX/TX ownership/frequency/mode where the target requested them. A matching
pre-command observation cannot confirm even if it arrives afterwards. An observation at or after the
deadline yields timeout. Mode comparison trims/uppercases but preserves USB versus LSB and DIGU
versus DIGL; `StationMode.loggingFamily` is a separate presentation boundary and cannot confirm tuning.

Duplicate/reordered sequences, backwards observation time, future time, and prior-context callbacks
are rejected. Mismatch, stale, non-ready or optimistic snapshots leave a pending tune unconfirmed.
Unknown or disconnected state ends pending work as `.unknownDisconnected`. Explicit disconnect
invalidates the session, so late callbacks cannot resurrect readiness; a new context is required.
Failure events take `now` and preserve timeout when the deadline has already elapsed. Profile change
and reconnect supersede pending work, clear observations, and reject previous callbacks. Shutdown
permanently closes the coordinator and ends pending work as `.shutdown`. Terminal results cannot be
turned into success by a late ACK, failure, or observation. Outcome history retains only 64 requests.

## Provenance and evidence limits

Inspected xLog baseline: `453b8e832e36f86051919619dd155999204f86e4`, specifically
`Sources/XLogCore/XCatClient.swift` and `Sources/XLogApp/AppModel.swift` spot-tune lifecycle.
The existing macOS client distinguishes command acceptance from observed simplex confirmation and
the UI uses a spot generation to reject old completion. Its logging mode mapping and assumption of
simplex A are intentionally not generalized into the portable provider contract.

Inspected xCat HEAD: `b8f2e95527425247623dae366f94114bc0e1e94e`. Read `AGENTS.md` first, then
`Sources/XCatCore/Models.swift`, `RemoteAgentModels.swift` and `RemoteAgentClient.swift`.
The inspected xCat checkout was dirty: `git diff --binary | shasum -a 256` was
`fad2daaa7eacb924962ec8d0f6c1dad7eaa7993a170cc0b88d2cb731982a5939` at inspection.
The hash identifies tracked local changes, not a clean extraction baseline or untracked contents.
No xCat file was edited or copied wholesale. This module re-expresses the boundary and acceptance
rules; it is not an extraction of all xCat functionality.

Validation uses deterministic coordinator fixtures, a mock provider, Codable round trips, input
bounds and ordering/failure tests. These establish contract behavior, not Linux packaging, actual
provider compatibility, authenticated operation, real radio state, rotor movement, RF, or release
acceptance. Installed applications, live hardware, credentials and safety policies are untouched.
