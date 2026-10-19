# macOS 1.2.45 contest cold-launch acceptance — 2026-10-20

## Candidate identity

- Branch: `codex/not1mm-contesting`
- Functional source commit: `d9b78ebe3d902e53e600fe8901e46e6e716e3c19`
- Packaged source/version commit: `bc2ea7cf685b24953bcc2d9e0422ffdad77949ef`
- Embedded source changes: none
- Version/build: `1.2.45` / `1.2.45`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Package bundle: `prototype/src-tauri/target/release/bundle/macos/OM0RX-xLog.app`
- Signing identity: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- CDHash: `06e8c7207133e8575321772b040037c1569fd9c6`
- `CodeResources` SHA-256: `b2cdf06859ae87a724dd819cb70352212cc4df5e337f5fdca54442784bad78d7`
- Package and installed-app `codesign --verify --deep --strict`: passed
- Rollback bundle: `/Users/oliver/Documents/Backups/OM0RX-xLog-before-1.2.45-20261020T034702+0930/OM0RX-xLog-1.2.44.app`

The installed bundle's version, CDHash and `CodeResources` hash match the package. The embedded `Not1MM/python-runtime.json` records source commit `bc2ea7cf685b24953bcc2d9e0422ffdad77949ef`, `sourceChanges: []`, Python 3.12.4 and successful relocated-runtime acceptance.

## Corrected behavior

- Native child-window commands are not acknowledged while the contest catalog, saved session, setup, log page, score, rates and CW state are still being restored.
- The existing retained native-navigation contract retries the command after startup settles; it is acknowledged only after the requested detached window opens.
- `Contest Setup` remains immediately available during startup.
- When startup has genuinely completed without a usable session, child-window commands retain the existing safe fallback to Contest Setup and explain that a contest must be opened.
- No contest rules were translated into Swift or added to the Python-to-JSON-to-Swift rule path.

## Actual installed Tauri behavior

These observations were made through `/Applications/OM0RX-xLog.app`, not a browser mock or direct Python request.

- From a cold application launch, the first and only native `Contest > Main Logging` command opened `OM0RX-xLog Contest — Main Logging`; no second menu command was required.
- The requested window was frontmost and showed the restored CQ WW CW session at 14,025.13 kHz, CW, operator OM0RX, SNT/RCV 599, sent zone 15, S&P state, F1–F12 macros and initial Callsign focus.
- The hidden Contest Setup owner window existed in the background as designed; it did not replace or obscure the requested Main Logging window.
- The ordinary xLog window simultaneously retained the DB3KE draft at 14.166000 MHz, 20m SSB, Manfred Schulz, JO30EW, Germany and `DLFF-1243`, and its integrated logbook showed `1–15 of 68,321`.
- No QSO, Enter/ESM, function key, CW, PTT, tune, radio, rotor or log mutation was used.

## Data preservation

After clean shutdown:

- Normal database `PRAGMA quick_check`: `ok`
- Normal database: 68,322 total rows, 68,321 active rows, one historical soft-deleted row and two dirty rows
- Normal database revision: 100641
- Normal database SHA-256 before and after replacement/acceptance: `bfe66dab8731ee1a4a94b8660b8061412cc8b99d2deac7c0a4dbabc29097052b`
- Active contest database `PRAGMA quick_check`: `ok`; `DXLOG`: zero rows; unchanged SHA-256 `5b8a627c5eb9a79b09fd9e3a069025288c67763cfc167b35f61203a84f998f6c`
- Second retained contest database `PRAGMA quick_check`: `ok`; `DXLOG`: zero rows; unchanged SHA-256 `39c721abc15211abf9fb96e0f25c358e91441fc59ce4714f2bc1b4a93543efeb`

## Verification performed

- Restoration and native-navigation focused suites: 37 passed.
- Production TypeScript/Vite build and detached-window bundle checks: passed.
- Rust contest-surface validation: 18 passed.
- Independent Sol review after the full-restore guard: no blockers.
- Packaging preflight: four checks passed; Swift worker build/self-test, Hamlib staging, distribution metadata, Tauri release build, bundled-Python relocation, nested Developer ID signing and final strict verification passed.
- Actual installed-app cold launch: normal log/draft restore and first-command Main Logging opening passed.

## Exact remaining limitations

- Shift-Tab, Space-from-Callsign and Enter/ESM remain covered by automated tests and the 1.2.44 acceptance record but were not exercised against RF-capable output in this checkpoint.
- The complete Not1MM plugin catalog, all independent configuration dialogs, new/open database workflows, every manual window and the remaining contest workflows are not yet complete.
- Real CW/PTT/RF, physical rotor movement and a live-station contest QSO were not exercised.
- The bundle is Developer-ID signed but was not notarized in this checkpoint.

This is an implementation checkpoint, not completion of the full Not1MM port.
