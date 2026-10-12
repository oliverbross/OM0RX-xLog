# Native local UI acceptance on macOS

Two independent native macOS launches passed the current integrated local UI
workflow on 13 October 2026. The test used a release executable with embedded
frontend assets and the real Swift/SQLite worker, not a browser mock. It did not
replace the installed signed Integration app or exercise external accounts,
network services, radio commands or rotor motion.

## Exact build and evidence

- Build source: `16ab386683c10dab360e72aa5e2353ace44c3cc4` (documentation-only
  follow-up to implementation `c4e0562c8e74a23ef23d15ba1e051b59826ffa45`).
- Main executable SHA-256:
  `24154ac061b8cebb974add6a024c4d016da8b4dfbf1764c0285981a7373d60d4`.
- Worker SHA-256:
  `0bb63756dc299f1425471e2667b248819a0cf33c1bd947d88fed0aad730492f8`.
- [First native report](evidence/native-ui-c4e0562/mac-1.json).
- [Second native report](evidence/native-ui-c4e0562/mac-2.json).

Both processes exited successfully with all 16 required checks true. Each
launch created its own disposable local workspace and private browser profile.
The workflow saved a W1AW QSO through the rendered desk, read back its exact
persisted fields, navigated the logbook/editor with shortcuts, cleared an
unsaved draft, saved TEST1 station settings and read those settings back. It
loaded the 192-programme awards catalogue, changed band-map text scale to 110%,
and verified that the detached window received that state.

The final map was visible and its actual WebGL framebuffer matched all 183
sampled land pixels in both runs. Each subsequent launch started empty and again
reached 110% after one scale increment; neither previous test's logbook nor its
browser preference survived into the next session. Awards became ready in 50 ms
and 51 ms with one test QSO. These are small-workspace observations, not a
benchmark of the operator's 67,846-contact logbook.

## Operator application restored

Only Integration was quit before testing. The original native xLog app and its
data were untouched. After both test processes exited, the existing installed
Integration app was reopened through native app controls. Its accessibility
state showed 67,846 contacts, station OM0RX / JN88TQ, an empty callsign draft,
radio offline and ShackCQ connected with incoming spots. Process inspection
showed the installed Integration executable and its worker, with no remaining
acceptance executable or worker.

## Remaining acceptance

This proves the isolated current-UI workflow on the local macOS development
machine. The exact build has not been signed, notarized, installed or released.
Clean Windows/Linux runtime results, large-log responsiveness, high-DPI/resizing,
assistive technology, network/vault parity and the named physical hardware
matrix remain separate gates. Native matrix run `38285494988` is testing the
same implementation source on all three operating systems.
