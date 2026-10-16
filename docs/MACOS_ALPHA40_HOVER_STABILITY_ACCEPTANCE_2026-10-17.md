# macOS alpha.40 hover-stability acceptance — 2026-10-17

## Scope

Release `0.4.0-alpha.40` removes the row-height jump seen while moving the pointer between logbook entries and Operator Desk cluster spots.

## Root cause and correction

- The logbook conditionally inserted its Club Log follow-up action when a row became hovered or focused. The button inherited a 27 px global minimum height, so the row geometry changed and the table bounced.
- The follow-up action now remains in the row DOM at a fixed 20 x 20 px size. CSS visibility exposes it on `:hover` or `:focus-within` without changing layout or removing keyboard access.
- Operator Desk compact cluster rows now have a fixed 28 px height. Hover changes only the colour of an inset shadow; it adds no border, transform, or content.

## Source and automated verification

- Source commit: `b175d82` (`Keep logbook and desk rows stable on hover`)
- Focused tests: 34 of 34 passed across `LogbookPanel.test.tsx` and `OperatorWorkspace.test.tsx`.
- Production frontend build: passed (`tsc --noEmit`, Vite production build, detached-window bundle checks).
- macOS package build: passed, including worker self-test, Hamlib helper verification, and Developer ID signing.

## Bundle acceptance

- Built bundle version: `0.4.0-alpha.40`
- Installed bundle: `/Applications/OM0RX-xLog.app`
- Installed acceptance: passed, 33 of 33 checks.
- Acceptance scope: `integrated-local-ui`
- Embedded UI: true
- Worker: true
- Station I/O: false (not exercised by the local acceptance suite)
- Signing authority: `Developer ID Application: Oliver Bross (4WCMQ4U946)`
- Team identifier: `4WCMQ4U946`
- Main executable SHA-256: `ef6830fc8f164d984699a9e770b722423258dc2cdc2331818ba76f03b1f105bc`
- Runtime after installation: main application and worker both running.

## Rollback

The replaced alpha.39 application remains available at:

`/Users/oliver/Documents/OM0RX-xLog-PreAlpha40-Backup-20261016T164125Z/OM0RX-xLog.app`

Its version and strict code signature were verified before alpha.40 replaced the installed copy.
