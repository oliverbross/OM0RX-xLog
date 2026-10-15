# Responsive window audit — 15 October 2026

## Scope and source

- Exact implementation source:
  `f658c7d77f1d1e80b197474da429da34709e78a7`.
- Scope: rendered development fixtures only; no native IPC, credentials, live
  contacts, network services, radio, amplifier, tuner, rotor, PTT, Tune or CW
  action was available to the fixtures.
- The audit covered 13 representative task surfaces at 360, 480, 640, 800,
  1,280 and 1,920 CSS pixels: **78 rendered combinations**.
- A second boundary matrix covered Logbook and Spot History at 19 widths from
  360 through 1,920 pixels, including 899/900/901, 1,187/1,188, and
  1,199–1,220 pixel transitions: **38 rendered combinations**.

## Finding and implementation

The initial 78-case sweep found no document-level horizontal overflow. It did
find that the user-configurable Logbook and Spot History tables still preserved
their complete desktop column widths inside 360–800 pixel windows, requiring an
internal horizontal rail.

The fix keeps the resizable desktop table above the narrow-container boundary.
At 1,200 pixels and below, the same selected columns reflow into labelled
two-column records; at 520 pixels and below they reflow to one column. The
underlying table, row identities and accessible cell/header relationships stay
present. User column selection, desktop widths/resizers, row selection,
keyboard navigation, edit/details actions, confirmation state, paging and
adaptive page capacity are unchanged.

## Verification

- Post-fix 13-surface/six-width sweep: **78/78**, zero document overflow and
  zero controls or tables outside their window.
- Focused breakpoint sweep: **38/38**, including both sides of the responsive
  boundary, with zero overflow.
- Narrow 480×800 Logbook and Spot History renders were visually inspected;
  labels, long callsigns, long country/comment values, confirmation icons and
  footer controls remained readable.
- Browser console and page-error logs were clean for both narrow surfaces.
- Focused component/responsive tests: **46/46**.
- Complete frontend suite: **2,400/2,400 across 160 files**.
- TypeScript and the production Vite/detached-window bundle gate pass. The only
  build advisory is the pre-existing large-chunk warning.
- The uninstalled Mac bundle embeds exact source
  `f658c7d77f1d1e80b197474da429da34709e78a7`, passes strict deep-signature
  verification and passes isolated **33/33** integrated-local-UI acceptance
  with `station_io: false`. The arm64 host SHA-256 is
  `fa00c1cc57d5eeb69ccb97d0bcd0274603a75158a4b6f7cef058f0b939bef5ff`; the
  universal x86_64/arm64 worker SHA-256 is
  `68279e1c7aeaf963d012ef6da66f4ef4d6355d969fc80d9af6e2378748153e4a`.
  The acceptance process exited cleanly and the candidate was not installed.
- `git diff --check` passes.

## Remaining acceptance boundary

The browser fixtures and isolated package prove source rendering and native
bundle integration, not mixed-DPI, monitor-disconnect, accessibility-technology
or operator-workspace behavior. Those remain explicit Mac operator gates;
Windows and Linux packaging remains deferred until Mac acceptance.
