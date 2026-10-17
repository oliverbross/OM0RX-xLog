# OM0RX-xLog 1.0.0-beta.3 macOS release acceptance — 17 October 2026

## Release identity

- Packaged source commit: `59d6e53` (`Stop background Keychain prompts and restore Wavelog spot parity`), on `codex/macos-alpha33-release`.
- Installed bundle: `/Applications/OM0RX-xLog.app`.
- Bundle identifier: `com.oliverbross.xlog.integration`.
- Version: `1.0.0-beta.3`.
- Signing: Developer ID Application `Oliver Bross (4WCMQ4U946)` with hardened runtime and Apple timestamp. `codesign --verify --deep --strict` passes for the app and its embedded helpers. Notarization is not claimed.
- Installed UI SHA-256: `7129c8d313a8e729328cb1011d6984593a8edb3a8517843ff8b00180ba083f94`.
- Installed worker SHA-256: `7259203c30df582b5a171590dff91c4b339ed2321fc8a658265a4b1f0dcdb29f`.

## Corrected cluster classification

Cluster status now follows Wavelog's QRG-mode grouping before evaluating historical contacts. CW remains separate, phone modes share the phone category, and FT8, FT4, RTTY, and generic DIGI share the digital category. Callsign and DXCC results still retain the separate band, mode-category, worked, and confirmed dimensions.

The focused `ClusterClassificationTests` suite passed 8/8, including the new Wavelog QRG-mode parity regression. The installed live cluster rendered mixed `Confirmed`, `Worked`, and `New DXCC` outcomes after loading real spots.

## Keychain and 15-second stability fix

Background and scheduled service paths now perform non-interactive credential reads. Only a user-started synchronization may request Keychain authorization. This prevents the 15-second online-log delivery cycle from blocking on a password dialog and recycling the worker or renderer.

The focused `AutomaticSyncTests` suite passed 19/19, including `testOnlyUserStartedSyncMayPresentKeychainAuthorization`. The UI timing suites passed 9/9.

After normal launch of the installed application, the same UI process (`98432`) and worker process (`98438`) remained alive for 50 seconds, spanning more than three 15-second background intervals. The integrated logbook and cluster loaded normally; no blank/remount cycle and no Keychain authorization window appeared.

## Packaged acceptance

The candidate and installed bundles each passed all 35 isolated native checks:

- `status: passed`;
- `scope: integrated-local-ui`;
- `embeddedUi: true`;
- `worker: true`;
- `station_io: false`;
- zero failed checks.

This acceptance covers the production renderer, signed worker IPC, settings routing, Canvas and detached-window lifecycle, logbook flows, maps, Awards, Band Maps, Spot History, and station-safe behavior. No physical station command was sent.

## Installation and rollback

The previously installed interim beta.3 is preserved at:

`/Users/oliver/Documents/OM0RX-xLog-InterimBeta3-Backup-20261017-1020/OM0RX-xLog.app`

Its UI and worker hashes differ from the final candidate and were recorded before replacement. The older beta.2 rollback remains at `/Users/oliver/Documents/OM0RX-xLog-PreBeta3-Backup-20261017-001/OM0RX-xLog.app`.

The final installed executable hashes exactly match the accepted candidate.

## Hardware boundary

The radio, amplifier, tuner, and rotor were not exercised. Packaged acceptance reports `station_io: false`; physical RF and motion verification remains an operator-present gate.
