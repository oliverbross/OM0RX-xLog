# CW UI documentation handoff — 2026-10-13

## Scope and disposition

**Ship the narrow CW UI extension at the source and synthetic-preview scope.**
The independent finish reviewer identified one preview-length mismatch; the
handoff reports that fix resolved and the disposition as ship. This document
records the finished surface against the incumbent design. It does not approve
a new visual world, refresh the global design system, or establish installed-app,
physical WinKeyer, radio, RF, signing, or cross-platform acceptance.

The artifacts are `prototype/src/live/CWSettings.tsx`, `CWDesk.tsx`, and `CW.css`,
integrated through `ServiceSettings.tsx` and the Active QSO area of
`OperatorDesk.tsx`. The direction remains the Operate-mode contract in
`docs/CW_UI_DIRECTION.md` and
`.impeccable/surfaces/prototype-src-live-cwsettings-tsx.md`.

## Evidence checked

The documentation pass read both direction records, `PRODUCT.md`, `DESIGN.md`,
the three CW surface files, their integration points, incumbent global/live and
settings styles, the synthetic fixture, and the preview-limit regression source.
It opened all six PNGs below and checked their file dimensions. These are image
dimensions, not independently measured browser viewport or device dimensions.

| Capture under `.impeccable/review/cw/` | PNG dimensions | Observed surface |
| --- | --- | --- |
| `settings-wide.png` | 1440 × 1000 | Radio output, message list, selected editor, preview and Save |
| `settings-laptop.png` | 989 × 797 | Same editor at a narrower width; help text wraps |
| `keyer-laptop.png` | 989 × 1010 | Separate port/speed, consent, connection controls and disconnected status |
| `desk-wide.png` | 1440 × 1000 | CW row below Active QSO; all five fixture macros visible |
| `desk-laptop.png` | 989 × 761 | Arm and Stop remain visible; one macro moves to More macros |
| `desk-hidpi.png` | 3840 × 2160 | CW row within Active QSO beside the existing intelligence panel |

Every capture identifies itself as a synthetic layout fixture with no worker or
hardware connection. `prototype/tests/visual/cw-preview.tsx` supplies synthetic
QSO/state data and a local request stub. The captures establish the shown layout
and content only; they do not establish real transmission, recovery, account
state, complete application geometry, or packaged WebView behavior. The desk
captures show the disarmed state, not a successful live send.

The resolved review finding is visible in source: both the Settings preview and
desk tooltip use `cwOutputLimit(profile.output, radioProvider)`. The shared rule
allows 80 characters for Hamlib radio output and 128 for the other supported
routes, including independent WinKeyer. `CWPreviewLimits.test.tsx` contains nine
boundary cases checking agreement between preview and tooltip and checking that
rendering makes no request. `docs/CW_IMPLEMENTATION_STAGE.md` reports the passing
344-test frontend suite and TypeScript/production-build checks. This documentation
pass inspected that record and regression source; it did not rerun those checks.

## Consistency with the incumbent design

The finished surface extends the existing console: navy canvas/panels, raised
navy controls, fine separators, the inherited system font, compact labels and
monospaced message text. `CW.css` reuses the incumbent panel, control, border,
secondary-text and semantic accent variables. Its editor and preview use modest
6-pixel corners; no decorative imagery, gradients, glow or new panel system was
introduced.

Settings preserves the existing tab and Save patterns. Output choice precedes a
compact message list and one selected editor. Preview is explicitly labelled as
non-transmitting. WinKeyer connection has its own controls, consent and textual
state. The screenshot evidence shows the consent unchecked and connection
disabled; it does not validate physical serial-line behavior.

The Operator Desk keeps the incumbent Active QSO form dominant. CW controls sit
below it behind a thin divider. Neutral Arm, restrained coral Stop and named
macro colours remain visually distinct. Overflow moves into a labelled More
macros select in the laptop capture. Macro colour is optional operator
configuration, accompanied by names and shortcuts; the allowed pink macro tint
is local to this surface and does not redefine the suite's classification colour
rules.

Source includes explicit labels, a keyboard-operated vertical message tablist,
textual status and cyan focus outlines. These are inspected implementation
features, not a claim of complete assistive-technology acceptance. Existing
container/field rules reduce spacing and stack fields at narrower widths; the
six captures are the bounded visual evidence, not proof at every window size.

## Existing drift and preservation

`DESIGN.md` remains the incumbent design authority and is unchanged. Its SHA-256
at documentation review was
`95804e8c53ed9eb8c070424f03a2628b5fdb74e527e6293756b1387b522e5fee`.
`.impeccable/design.json` was absent on inspection and is not tracked; its absence
is preserved. No sidecar was generated.

Pre-existing differences are recorded rather than repaired:

- `DESIGN.md` uses its older prose headings and has no token frontmatter; it does
  not follow the current Impeccable document reference's canonical schema.
- The documented secondary text is `#92A7BF`; the incumbent stylesheet uses
  `--secondary: #a6b6ca`, already present in `HEAD`.
- The documented station rail is 44 points; incumbent live CSS already uses a
  58-pixel minimum. Global controls use a 5-pixel radius, while the design prose
  describes 6–10 points. These are existing implementation/documentation
  differences, not changes made by the CW documentation handoff.
- Product context describes the authorized shared React/Tauri successor while
  parts of the design prose still describe the earlier native macOS structure.

There is no authorized global-system change in this extension. A future explicit
design-document refresh can reconcile these differences using the actual shared
interface as evidence.

## Asset provenance and acceptance boundary

No shipping raster assets were added. The six PNGs are review evidence generated
from the synthetic fixture; they are not product artwork. Controls use existing
CSS and Lucide vector icons.

The final disposition applies to the reviewed CW surface and the resolved
preview-length issue. Installed Tauri behavior, real serial control lines,
physical Send/Stop outcomes, RF behavior, device compatibility and Windows/Linux
packages retain their separate acceptance requirements. No installed or hardware
success is claimed by this handoff.
