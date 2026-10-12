# Alpha.9 installed acceptance 13 October 2026

Alpha.9 corrects CHASER-01 and is installed in the canonical Integration location.
Its signed bundle passed the isolated native workflow and installed read-only
Chaser checks. Full application parity and hardware acceptance remain open.

## Exact package

- Source: `250053b45ad563df2b1a651fadd498d6f6298be5`, clean and pushed before build.
- Version: `0.4.0-alpha.9`; installed distribution metadata matches the source.
- Developer ID Application: Oliver Bross, team `4WCMQ4U946`.
- Apple notarization `6b0604fd-3129-4ace-b3c9-629a627ff537`: Accepted.
- Built and installed strict deep signature, staple and Gatekeeper checks passed.
- Archive SHA-256:
  `bc44eadc093cf40494bf6c63946f3ff94f89433e3ed6dd6266172075f074e95e`.
- Installed main executable SHA-256:
  `afb1b4df0388d4dda71ef552ea0b8eae3d4bfa9bc0bc02abf81f36078b378681`.
- Installed worker SHA-256:
  `ab3a54ebd26f9858edc6172507abd5395a103eed0620bea2eb14d12c4f83ed51`.

## Native workflow and preservation

`evidence/native-ui-alpha9/mac-signed-large.json` reports all 21 checks passed,
including the detached projection and 70 matching map probes. With 100,002
generated contacts, first logbook display was 69 ms, cold Awards 689 ms, repeat
Awards 18 ms, first/repeat local history 216/235 ms and rendered history 24 ms.
The isolated workspace prohibits station I/O. These are single-run timings.

The initial validation launch exited without a report while another Integration
instance was running. It is not counted as a pass. After closing only Integration,
the isolated rerun produced the successful report and exited normally.

Before replacing alpha.8, a read-only comparison against its preinstall SQLite
backup found zero added, removed or changed QSO IDs/record JSON and 67,846 live
contacts. The original native xLog executable remained unchanged, SHA-256
`7a2b244545c9eb2639cde5f0a152c9cfaf40e2e06fde9ad97fd3184e37efdb97`.
The alpha.9 launch retained OM0RX / JN88TQ, the empty draft and contact count.
One installed Integration process and its worker were observed. ShackCQ resumed
without pressing Connect and received new spots; radio and rotor stayed offline.
The same read-only QSO comparison after alpha.9 installation again returned
67,846 live contacts and zero added, removed or changed records.

## CHASER-01 verified fixed

In the installed 1440 by 940 window, the incoming KE2CIE / KFF-2099 observation
at 14.240 MHz appeared once, labelled WWFF, with the directory name Long Point.
Selecting Programme POTA showed zero rows rather than the erroneous duplicate.
Restoring All and pressing Refresh view retained that WWFF row and added the
genuine KF0UWE / POTA US-9309 observation separately, with its directory name.
Programme labels were legible in the existing reference column. Native screenshot
and accessibility evidence are in the task transcript, not exported media files.

No row was loaded, tuned or logged; public source Check buttons were untouched.
All remained truthfully unavailable with no verified snapshot. The filter was
restored to All and the app returned to the empty Operator Desk.

## Remaining boundaries

Public feed/account acceptance, physical radio/keyer/rotor operation, physical
Windows/Linux desktops, high-DPI and assistive-technology checks remain open.
The preceding shared-feed source passed all platform builds and Linux/Windows
runtime checks in CI run `38295724601`. The exact alpha.9 matrix
`38298414791` completed successfully on macOS, Windows and Linux, including
Windows fresh-runner and Linux runtime-only container acceptance. No full-parity claim follows
from the Mac package or this one Chaser correction.
