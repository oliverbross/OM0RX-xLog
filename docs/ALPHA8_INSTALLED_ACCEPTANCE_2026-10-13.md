# Alpha.8 installed acceptance 13 October 2026

Alpha.8 is installed in the canonical Integration location. The signed bundle
passed the isolated large-log workflow, but installed inspection found a Chaser
classification defect. Public release is held while that finding is addressed.
Full parity and hardware acceptance remain open.

## Exact package

- Source: `9a7863501d96a06eea859ea589afc88a60101b53`; clean and pushed before build.
- Developer ID Application: Oliver Bross, team `4WCMQ4U946`.
- Apple notarization `25481c0a-b144-4942-9c87-de3e3a442afc`: Accepted.
- Strict deep signature, staple validation and Gatekeeper checks passed for
  the built and installed app.
- Archive SHA-256:
  `306a9939308686bd71777c6cb4ccbf50d2f27a44198524280a37d969e7d2e7db`.
- Installed main executable SHA-256:
  `26bb1d4adf903b90581de5a594138e9a0084d7b49b76e7c84807f45a1d6eb982`.
- Installed worker SHA-256:
  `74274bec0409627a546f9b105b1878b5f451c2949c9baf7fd78d085536647b73`.
- Original native xLog executable remains unchanged:
  `7a2b244545c9eb2639cde5f0a152c9cfaf40e2e06fde9ad97fd3184e37efdb97`.

## Isolated and installed checks

The exact signed bundle completed all 21 native checks with 100,002 generated
contacts, detached projection and 70 matching map probes. It exited normally.
The generated report is `evidence/native-ui-alpha8/mac-signed-large.json`.
First logbook display was 72 ms, cold Awards 697 ms, repeat Awards 31 ms, local
entity history 217 ms and rendered callsign history 10 ms. No external services
or hardware were permitted in this disposable test workspace.

Before installation, a private SQLite backup passed quick_check and contained
67,846 live contacts. Only Integration was replaced. Installed startup retained
OM0RX / JN88TQ, 67,846 contacts and an empty draft. Radio remained offline and
ShackCQ automatically connected and received new spots. One Integration process
and one associated worker were observed.

The real Awards page contained all 192 programmes, DXCC 286/276 confirmed,
WAZ 40, WAS 50 and AJA evidence-eligible 1,473 in the first accessibility capture
918 ms after initiating navigation. The logbook table was populated in the
first capture at 854 ms. These include automation/accessibility overhead and
are not input-to-paint measurements or p95 results.

The Chaser page loaded cached/local evidence and live cluster observations.
All five public sources correctly showed no verified snapshot; their Check
buttons were not pressed. No QSO was selected, saved, synchronized or tuned.

## Open installed finding CHASER-01

Severity: medium. Category: classification and presentation.

In Chaser & DX with Programme All, K5G / KFF-3017 and KE2CIE / KFF-2099 each
appeared twice. One row had a verified directory name and the other said
Name unavailable / Not in installed directory. Refresh view preserved both
pairs. Selecting Programme POTA retained the unverified KFF rows, confirming
that WWFF references are also being presented as POTA references. The native
screenshot and accessibility captures are retained in the task transcript;
this is not a source-inferred finding.

Reproduction: receive a cluster spot containing a KFF reference, open Chaser &
DX, compare All and POTA, then refresh the cached view. Expected: the WWFF
reference appears under WWFF only unless the spot also contains a distinct
explicit POTA reference. The main table should make programme identity clear.

No erroneous row was loaded into the draft. This gate is open pending a parser
regression test, correction and exact-package recheck. Existing compact/high-DPI
and cold Awards performance gates also remain open.

Alpha.9 source now corrects the shared parser and adds programme labels in the
table. Regression coverage reproduced the original classification failure and
passed after correction. This does not close the installed gate above until the
replacement package is checked.
