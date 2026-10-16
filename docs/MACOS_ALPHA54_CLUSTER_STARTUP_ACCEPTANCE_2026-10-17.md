# macOS alpha.54 cluster startup acceptance — 2026-10-17

## Scope

- Connect every enabled, configured DX Cluster server when xLog starts.
- Request 100 recent spots with `sh/dx/100` after each successful connection.
- Expose separate default-on controls for startup connection and recent-spot retrieval.
- Keep transport reconnection after an interruption as a separate setting.

## Implementation evidence

- Existing configuration files decode both new options as `true`, so the behavior is enabled without requiring a Settings save.
- Native startup ignores the previous running session's Connect/Disconnect receipt and follows `connectOnStartup` once per app launch.
- Each server sends `sh/dx/100` only when its state changes into connected. Repeated connected callbacks do not duplicate the request; a genuine reconnection sends it again.
- Cluster Settings exposes:
  - **Connect automatically when xLog starts**
  - **Request 100 recent DX spots after connecting**
  - **Reconnect automatically after an interruption**

## Focused verification

- `XClusterIntegrationTests.ClusterSessionServiceTests`: 14 passed, including default-on migration, one request per connection transition, reconnection, and opt-out behavior.
- `Portable live cluster worker bridge`: 9 passed, including launch ownership, launch opt-out, old intent migration, and workspace integration.
- `XLogPrototypeTests.LiveSpotHistoryTests`: 8 passed.
- Vitest cluster UI/startup selection: 37 passed across `ClusterPanel`, detached cluster, restart policy, and native restart ownership.
- TypeScript typecheck passed.
- Packaged-app acceptance: 33/33 checks passed with `station_io=false` in the isolated acceptance profile.
- Candidate and installed app passed strict deep code-signature verification.

## Installed result

- Installed version: `0.4.0-alpha.54`
- Source commit: `5ba04a468833b5853d9feabf8c5246952ce6a626`
- Installed executable hashes match the accepted candidate:
  - UI: `8494f94c3aac0b45185a64deebb8d2b621d3eace0cef56414d3b7d4cd35bde2f`
  - Worker: `99d6cbca64cba04d25aca9aa89baad7618a4e7da1c1fb34ec8f25d475606ba95`
- Rollback app: `/Users/oliver/Documents/OM0RX-xLog-PreAlpha54-Backup-20261017-0557/OM0RX-xLog.app` (`0.4.0-alpha.53`)

## Live external boundary

The installed app launched and automatically attempted the configured ShackCQ connection without operator action. macOS then presented the saved-password Keychain authorization dialog for the newly signed worker; without that password authorization, ShackCQ closed the unauthenticated session. Therefore the automatic launch attempt is live-confirmed, while delivery of `sh/dx/100` to the external ShackCQ service is verified by the connection-transition integration test rather than claimed as live external proof. After the one-time Keychain authorization succeeds, the command is sent immediately on the successful connected transition.
