# macOS alpha.35 release acceptance — 17 October 2026

## Exact candidate

- Version: `0.4.0-alpha.35`
- Packaged source: `464022f`
- Architecture: Apple Silicon (`arm64`)
- Installed executable SHA-256: `f6a2eeed22380654ba7371b923215527f842a4562303a51de6035b629649979c`
- Installed worker SHA-256: `b2d6965e0ac832f76fd4989969b579c3bdda64a12c569fc62b5dbc6edc6877d1`

The installed hashes match the signed candidate exactly. Deep strict code-sign
verification passed with the configured Developer ID identity and hardened
runtime. This local test candidate was not submitted for notarization, so
Gatekeeper correctly reports `source=Unnotarized Developer ID`; this is not a
notarized-release claim.

## Band Maps delivery

- One normalized callsign is shown once per band; the newest report owns the
  marker and a later QSY moves it instead of creating another copy.
- The maps use a low-to-high vertical frequency ruler, restrained allocation
  shading and unboxed callsign/status labels in the existing operator colours.
- NC, NM, NB and NB+NM remain visible text classifications; meaning never
  depends on colour alone.
- Bottom controls provide direct band selection in the focused window,
  full-band or 1–40 px/kHz resolution and 15/30/45/60-minute spot age.
- Manual allocation, pan, zoom, wheel and drag changes enter a stable Custom
  range that is not replaced by a later window resize.
- The same controls and deduplicated projection are used by embedded and
  detached Band Maps. Raw Cluster and Spot History evidence is unchanged.

## Automated and visual evidence

- Focused Band Maps and detached-window regression suite: **39/39 passed**.
- TypeScript, production Vite build and detached-window bundle graph passed.
- The Impeccable static UI detector reported no findings for the changed Band
  Maps source and stylesheet.
- Synthetic browser review covered desktop and narrow/high-text layouts. The
  final page had no browser errors; ruler labels, opportunity codes and bottom
  controls remained visible without the prior duplicate-marker presentation.
- An independent code re-review passed the four acceptance points: one call per
  band, low-at-top navigation direction, Custom-range resize stability and
  persistent age/resolution controls.
- Both the clean candidate and the copied `/Applications` bundle passed the
  isolated native acceptance report with **33/33 checks**, `embeddedUi=true`,
  `worker=true` and all reported `stationIO` fields false.

The raw built and installed reports are retained beside the rollback bundle as
`alpha35-built-acceptance.json` and `alpha35-installed-acceptance.json`.

## Installation and rollback

- `/Applications/OM0RX-xLog.app` reports `0.4.0-alpha.35` and is running from
  the installed bundle with one host/worker pair.
- The replaced alpha.34 application and both alpha.35 acceptance reports are
  retained under
  `/Users/oliver/Documents/OM0RX-xLog-PreAlpha35-Backup-20261017T0018/`.
- No live QSO, provider sync, radio tune, PTT, CW transmission, amplifier or
  rotor command was issued during package acceptance or installation.
- Physical radio/FLEX/TCI behaviour and operator visual acceptance remain
  separate from this isolated package evidence.

