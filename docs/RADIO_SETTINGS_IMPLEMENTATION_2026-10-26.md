# Operator-first two-radio settings

Implemented on canonical `main`, preserving baseline `311478d3` and all work after the reviewed `51fbe1a4a4f30072a6f7a929171b0882aa1cdb76`. Not1mm confirmed no competing edits or packaging. The separate CW Skimmer task owns its native/IQ modules and coordinates a clean packaging hold; those modules are not radio-settings acceptance.

## Reference and delivered interaction

RUMlogNG's installed TX 1 and TX 2 preferences were inspected visually on 26 October with explicit launch permission. No configuration control, connection, port, scan or discovery action was changed. The four original attachment paths were recovered from the earlier radio-settings chat, but their temporary image files no longer existed. The installed preferences and official [CAT settings](https://dl2rum.de/RUMlogNG/docs/en/pages/CAT-Prefs.html) and [SunSDR/Flex guidance](https://dl2rum.de/RUMlogNG/docs/en/pages/SunFlex.html) supplied the reference.

Settings → Radios is the configuration owner. Both independently mounted slots use the same compact transceiver/connection form, xLog styling, manufacturer filtering and searchable model picker. The bundled read-only catalogue loads automatically with stable request identities/cache and a visible retry. Native models use their existing Flex or TCI provider; conventional models retain exact catalogue IDs. Unknown model IDs and absent serial paths remain available rather than being replaced.

Only applicable fields appear: Flex address/port; TCI computer host/port/receiver; enumerated serial port/baud; retained or explicitly selected CAT TCP bridge host/port; or Remote Station Agent address/token. Existing loopback rigctld remains under Advanced. Serial listing uses the existing inventory-only implementation and never opens a device. Model IDs, framing, full TCI URLs and operation identities are under Advanced/Diagnostics. TCP bridges require the chosen model's existing CAT protocol, not a new driver or Icom server implementation.

Manufacturer, model, interface, nickname, enable state and settings-tab changes affect drafts only. Save persists configuration and passive labels atomically through the existing per-slot Session. Save & Connect sequences scoped save, confirmed release/disconnect when replacing a live connection, provider handover, then connect; every step reads a fresh revision and stops on conflict or uncertainty. It checks that the saved settings still match before connecting, preventing another window's newer configuration from being connected accidentally. Save alone never selects a provider or disconnects a live radio.

The existing journal v2 gains an optional, backwards-compatible `profile` object containing manufacturer/model display names, nickname, desired provider and enabled state. Numeric model IDs and all transport settings remain in their existing fields. No second configuration store, connection owner, profile framework or CAT implementation was added. Existing journals without metadata load unchanged; disabled slots retain their settings and cannot auto-resume or connect until explicitly enabled/saved. Pending setup receipts remain visible across later saves; explicit review is durable and does not turn an unknown outcome into confirmed hardware state.

Normal station areas and contest Remote VFO have a model/nickname-based operating selector. It changes only active routing and retains both receiving connections. Native TX routing locks are preserved; a held TX lease is described as transmit control, never physical transmission. Unresolved operations refuse switching. Changing a standby receiver's connection no longer revokes the operating radio's CW/automatic-rotor context. Detached Station Control retains observations and the existing exact manual tune owner, while configuration lives in Settings. The unscoped legacy `stationHandover.ts` helper was audited and is not used by any new two-slot operation.

Unsaved radio text and pending operations block leaving Settings, workspace/module changes and normal main-window closure. Switching service tabs or radio tabs retains each mounted draft. Cross-window changes retain typed text and require an explicit saved-setup review.

## Source acceptance before packaging

- 874 native application tests passed, including per-slot migration/restart, exact target routing, TX refusal, journal uncertainty/review, and two actual bundled Hamlib Dummy receivers through the saved Session paths. Both receive connections remained live; tuning Radio 2 left Radio 1 at its original frequency; Radio 2 PTT was refused; disconnecting Radio 2 left Radio 1 connected. Only test-owned dummy processes were involved.
- 93 focused frontend tests passed across radio settings, lifecycle primitives, detached controls and manual tune. Nine new workflow tests exercise passive browsing, both Save & Connect sequences, save without handover, independent drafts, conflict/uncertainty recovery, replacement cancellation, concurrent-writer refusal and TX-control refusal. Legacy shared-lifecycle regressions remain in an explicit fixture after removal of the duplicate production detached configuration UI.
- The existing Settings lazy-loading timing assertion initially timed out under concurrent compilation and passed when rerun alone. No production behavior was altered for that test.
- TypeScript passes. Production bundle validation and focused Swift provider checks are recorded with the integrated candidate, after the CW task's coherent source batch completes.

## Provider boundaries

Flex uses the existing private numeric LAN/VPN endpoint policy. There is no discovery button, SmartLink claim or selectable slice/client binding. Manual address entry remains available. A chosen model label is not physical-device identity proof.

TCI targets the computer running ExpertSDR's server, preserves ws/wss endpoints and paths, and offers extra receivers only from fresh observed receiver counts (plus a retained saved index). This xLog path supports receive frequency/mode control and existing spots/filter functions; it does not supply CW, PTT, audio or IQ operation through radio settings. The separate CW Skimmer project is not implied by this form.

Conventional CAT uses the bundled helper/catalogue and its closed framing allowlist. There is no CI-V override or generic vendor-authenticated Ethernet/Icom-server implementation. External rigctld stays loopback-only. No hardware port, radio tune, RF/PTT/CW output, rotor motion or audio operation is authorized or claimed by these acceptance checks.

The integrated signed candidate, installed-app screenshots, exact source identity and data-preservation results are recorded in its release acceptance document.
