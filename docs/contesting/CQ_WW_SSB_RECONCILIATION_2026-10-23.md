# CQ WW SSB macOS reconciliation — 23 October 2026

## 1.3.1 installed candidate addendum — 24 October 2026

**READY WITH LIMITATIONS** for the requested CQ WW SSB 40 m workflow on
Apple Silicon macOS. This is the frozen candidate; it supersedes the 1.3.0
installed identity below without reopening broad Not1MM/N1MM parity work.

| Final gate | Concrete result |
| --- | --- |
| Canonical source | `3a534d57b92e8f1e52b9bc9038bae1c4361e6c42`, clean, committed and pushed to `origin/main` (`0 0` ahead/behind before packaging) |
| Installed application | `/Applications/OM0RX-xLog.app`, version/build `1.3.1` |
| Embedded source receipt | `sourceCommit` exactly `3a534d57b92e8f1e52b9bc9038bae1c4361e6c42`; the clean receipt has no `sourceChanges` entry |
| Signature | Developer ID deep/strict verification PASS for the packaged and installed bundles, embedded Python framework, worker, `rigctld` and `rotctld` |
| Packaged native acceptance | 35/35 PASS; `production_singleton: false`; `station_io: false`; report SHA-256 `bd42267fbbace14e47df9b0599282043deb415d6784f8ce2fccfd5e3edb05094` |
| Installed native acceptance | 35/35 PASS; `production_singleton: false`; `station_io: false`; report SHA-256 `9c8a181d53dc8573af11ff8928cac47c20e08ef5a843548d82f52b76e93ae906` |
| Frontend and review regression | Full run: 280 files / 4,126 tests plus 2 Node packaging tests PASS; final TypeScript/Vite build PASS; post-review CQ WW/Band Map run 199/199 PASS plus the transient-preview retry regression PASS |
| Native contest logic | Rust 832/832 PASS; CQ WW SSB Python host 22/22 PASS |
| Rollback | `/Applications/OM0RX-xLog-previous-20261024T053837Z-80897.app`, signed 1.3.0 receipt `fb1c59352046f4e35f93f873d6f893a201d06043` |

This candidate stabilizes the operating path reported during the live contest:
spot classifications are retained while the CQ WW preview is pending and retry
after a transient failure; Cluster, Band Map and Flex/Maestro publication share
the same green double-multiplier, red single-multiplier, blue valid-QSO and gray
dupe/non-workable result. Display spots are deduplicated by callsign, mode and
displayed 100 Hz frequency. S&P VFO changes clear the prior draft, load a nearby
contest spot and retain an unworked typed call as a local marked spot when the
operator tunes away. The typed call is also projected to the contest map.

The main CQ WW entry fields accept Enter from callsign, SNT, RCV or CQ zone,
DUPE calls are red, lookup bearings/distances retry after resolution, and
same-draft owner reconciliation no longer creates the false panel-changed loop.
The Rates window uses the available width. Code review found and corrected two
release risks before packaging: mode was added to spot deduplication, and a
transient preview failure now schedules a retry instead of leaving stale colors.

No acceptance step changed the radio frequency, published spots to a physical
radio, asserted PTT, played audio, moved a rotor, or created/edited/deleted a
production QSO. The remaining operator-controlled checks are therefore the live
Flex/Maestro tune/readback and spot-publication path, real CAT VFO clear/autofill,
physical-keyboard Enter behavior, authenticated QRZ lookup, and visual inspection
of installed Cluster/Band Map colors and the VFO arrow. Recorded voice is tracked
separately: recording presence, output routing, PTT release and actual transmitter
audio remain unaccepted and do not block manual-microphone logging.
Gatekeeper reports `Unnotarized Developer ID`; notarization remains outside this
operator-candidate freeze.

The installed 1.3.1 and one verified 1.3.0 rollback are the only application
bundles retained. The older `8f89e860` rollback and generated Rust/Tauri, Swift
worker, frontend and distribution-metadata output were removed after acceptance,
reclaiming approximately 2.9 GiB without touching settings, backups or contest
data. Durable reports are in
`docs/contesting/evidence/cq-ww-ssb-3a534d57/`. No next compatibility batch was
started.

## Final installed addendum — 24 October 2026

**READY WITH LIMITATIONS** for the requested CQ WW SSB 40 m operating workflow
on Apple Silicon macOS. This addendum supersedes the older candidate identity,
installed receipt and rollback details retained later in this document as
historical evidence.

| Final gate | Concrete result |
| --- | --- |
| Canonical source | `fb1c59352046f4e35f93f873d6f893a201d06043`, clean and pushed to `origin/main` (`0 0` ahead/behind) |
| Installed application | `/Applications/OM0RX-xLog.app`, version/build `1.3.0` |
| Embedded source receipt | `sourceCommit` exactly `fb1c59352046f4e35f93f873d6f893a201d06043`; `sourceChanges` empty |
| Signature | Developer ID deep/strict verification PASS for the installed bundle, embedded Python framework, worker, `rigctld` and `rotctld` |
| Packaged native acceptance | 35/35 PASS; `station_io: false`; SHA-256 `64b35a5a61190092be88e1d12415b3ffe81d0a4772a0769f8d1f622084ad2a23` |
| Installed native acceptance | 35/35 PASS; `station_io: false`; SHA-256 `98249bbd0e8c8b6a754a1d8faaf1a1450a85de0fec2d8882750fb62cfd3d498d` |
| Focused CQ WW desk | 153/153 React owner/surface tests PASS; TypeScript PASS |
| CQ WW SSB Python host | 22/22 PASS, including immutable pinned-country DUPE handling, fresh-zone prefill and VFO clear/spot-load behavior |
| Live installed inspection | Logging controls enabled; Wipe returned immediately; Messages displayed `No contest messages.`; at the observed radio frequency 7.161 MHz the contest desk automatically loaded cluster call `IB9TUP` with CQ zone 15 |
| ADIF import | The supplied N1MM ADIF imported 39 CQ WW SSB QSOs into session `4ac63449-bb24-4370-b159-e2b671321618`; database readback and ADIF export contained 39 contacts at the import checkpoint; pre-import backup retained |
| Rollback | `/Applications/OM0RX-xLog-previous-20261024T041656Z-59790.app`, receipt `8f89e860e3839803b2d359894bec225bc96f75a0` |

The final correction removes the cascading `Pinned country resolution changed`
/ owner-busy / stale-session loop, keeps exact logged-call DUPE detection
authoritative, resets CQ zone when the callsign changes, suppresses the false
unresolved-country notice for an empty draft, and makes CQ WW SSB S&P VFO
behavior deterministic: leaving a frequency clears the previous callsign and
tuning within 300 Hz of a visible contest spot loads that call and its exchange.
The behavior is mandatory for CQ WW SSB even when an older saved profile has
`clearOnVFOChange` disabled; Run mode and other contests retain their existing
policy.

Cluster and Band Map spot status now comes from the same authoritative CQ WW
preview: green is a double multiplier, red a single multiplier, blue a valid
non-multiplier QSO and gray a dupe/non-workable station. The ADIF import command,
Enter-from-entry-fields path, single-mutation Wipe, stale-zone correction and
diagnostic clearing are part of the same frozen candidate.

No acceptance step transmitted RF, asserted PTT, played audio, moved a rotor,
changed the radio frequency or created/edited/deleted a production QSO. The live
7.161 MHz result was observed from the operator's existing radio state. Recorded
voice remains separate from macro substitution: recording presence, output
routing, PTT release and actual transmitted audio were not accepted and do not
block manual-microphone logging. Windows/Linux, notarization, multi-Mac behavior
and broad all-contest parity remain outside this freeze.

The pre-import backup is
`/Users/oliver/Library/Application Support/Contesting/Python/Import Backups/4ac63449-bb24-4370-b159-e2b671321618-before-n1mm-adif-20261024T031400Z.sqlite`.
Two older superseded application bundles were removed after the final rollback
receipt was verified; one signed rollback remains. Generated Rust/Tauri, Swift
worker, frontend and distribution-metadata build directories were also removed,
reclaiming approximately 4.3 GiB without touching source, settings or contest
data.

## Executive verdict

**READY WITH LIMITATIONS** for CQ WW SSB on Apple Silicon macOS 14 or later
using a manual microphone.

The exact installed candidate is OM0RX-xLog `1.3.0` from clean canonical source
`fb1c59352046f4e35f93f873d6f893a201d06043` at
`/Applications/OM0RX-xLog.app`. Source, package receipt and installed receipt
agree. The completed workflow is CQ WW SSB entry, duplicate protection, scoring,
per-band country/zone multipliers, SCP, contest log, cluster opportunity view,
Band Map, statistics/rates, persistence/export and separate native windows.

This is not a claim of complete Not1MM parity, pixel-for-pixel N1MM Logger+
parity, recorded-voice RF readiness, multi-Mac acceptance, public-release
notarization, or Windows/Linux installed acceptance.

## What was completed in this finishing pass

1. **Contest spot semantics.** Cluster and Band Map use CQ WW opportunity
   meaning: blue valid QSO, red one needed multiplier, green both country and
   zone multipliers, gray worked/dupe. Worked spots are hidden by default and
   can be enabled explicitly.
2. **Exclusive operating modules.** Normal Logging and Contesting are mutually
   exclusive owners. Selection is persisted and restart-safe; renderer and
   native admission fences prevent both logging paths from accepting writes at
   the same time. The original main xLog window remains recoverable through the
   Window menu.
3. **Release-gate correction.** The Logbook startup budget now allows the
   demonstrated 20-byte Node 22/24 output difference while retaining a bounded
   402,250-byte ceiling. No product UI/runtime behavior changed in this commit.
4. **Exact package/install reconciliation.** The app was rebuilt and signed from
   `cb708501`, package and installed receipts show an empty `sourceChanges`
   array, both isolated native gates passed 35/35 with `station_io: false`, and
   the exact installed app was opened and inspected.
5. **Cleanup.** One signed immediate rollback and all data backups were retained.
   Two older app bundles, superseded release ZIPs/reports and approximately
   9.5 GiB of generated Rust/Swift build output were removed.

Implementation commits after the previous accepted `cb6f6759` candidate:

- `ca4aea92` — multiplier-semantic contest spot colors.
- `09d8ec37` — exclusive Normal Logging/Contesting operating modules.
- `cb708501` — bounded Node-version variance in the Logbook release gate.
- `8f89e860` — CQ WW live workflow, authoritative spot/DUPE projection and ADIF import.
- `fb1c5935` — final installed VFO clear/spot-load and quiet-message corrections.

## Candidate, tests and durable evidence

| Item | Result |
| --- | --- |
| Canonical source | `fb1c59352046f4e35f93f873d6f893a201d06043`, pushed to `origin/main` |
| Installed bundle | `/Applications/OM0RX-xLog.app`, version/build `1.3.0` |
| Source receipt | exact SHA, empty `sourceChanges`, final component-signature hash phase |
| Signature | Developer ID deep/strict PASS; Gatekeeper says Unnotarized Developer ID |
| CI | `39918021036` PASS |
| Cross-platform prototype | `39918021028` final FAIL: attempt 1 passed 279 files / 4,073 frontend tests and every build/integration step through desktop creation, then hit the 40-minute job ceiling during macOS packaging; attempt 2 ran 4,072/4,073 tests green and failed one unrelated ARRL DX async UI test, which passed 5/5 immediately when rerun locally |
| Contest portability | `39918699201` overall FAIL: macOS contest/native PASS; Ubuntu contest/native PASS; Windows contest PASS; definition generator PASS; Windows native FAIL on directory sync `Access is denied` |
| Local production frontend | TypeScript/Vite/bundle budget PASS; preceding full suite passed 279 files / 4,073 tests |
| Rust | preceding exact-product run passed 814 unit and 26 integration tests |
| CQ WW focused host | 22 tests PASS, including `OM0A -> CQ zone 15`, manual override preservation and VFO clear/spot-load behavior |
| Packaged native acceptance | isolated non-production gate: 35/35 PASS, embedded UI + worker, `production_singleton: false`, `station_io: false` |
| Installed native acceptance | isolated non-production gate: 35/35 PASS, embedded UI + worker, `production_singleton: false`, `station_io: false` |
| Previous accepted archive | `dist/OM0RX-xLog-1.3.0-cb708501-macOS-arm64.zip`; historical ZIP integrity PASS; superseded by the installed `fb1c5935` candidate |

Evidence committed with this report records the isolated native gates; bundle
identity and CQ WW behavior are established separately by receipt reconciliation
and installed-app inspection:

- `docs/contesting/evidence/cq-ww-ssb-cb708501/packaged-native-acceptance.json`
  — SHA-256 `ab0dea76e3725d0fd55dfea05562e225fe0d61317ee21e6e07ecfb818f1cf97f`.
- `docs/contesting/evidence/cq-ww-ssb-cb708501/installed-native-acceptance.json`
  — SHA-256 `c6e9df06c78c6f4f3c1435d6a4da9ba2938d99cea9dd693aeb859cf7a019184a`.
- Final archive SHA-256
  `689e231010e143ad67cb02cad6a090dd3800044ba8b4781af95d2648d5c39521`.

No production QSO was created, edited, deleted or transferred. No spot was
selected, radio setting changed, rotor moved, audio played, PTT asserted or RF
transmitted.

The cross-platform workflow is therefore not reported as green. Its first
attempt demonstrated the complete frontend suite and macOS build/integration
path but timed out in packaging; its cached second attempt exposed one
nondeterministic ARRL DX preview test while all other 4,072 tests passed. The
same ARRL DX file then passed all 5 tests locally. This is not part of the CQ WW
SSB operating workflow and was not used to widen this macOS freeze into another
contest-repair batch. Exact-source CI, both CQ WW macOS portability jobs, the
local signed package, and packaged/installed isolated native gates passed.

## Window-by-window reconciliation

The N1MM comparison uses the supplied 824-page *N1MM Logger+ Documentation*,
especially Available Mults & Qs pp. 267–271, Band Map pp. 272–284, Check Partial
pp. 285–289, Entry pp. 295–305, Info pp. 333–336, Log pp. 342–346,
Multipliers pp. 349–354 and Score p. 367.

| Window | Current CQ WW SSB behavior | Not1MM parity | N1MM manual match | Remaining difference |
| --- | --- | --- | --- | --- |
| Main Logging / Entry | RS + CQ zone, six HF bands, Run/S&P, Enter/ESM, correction/focus, F1–F12 always visible, radio header and compact country/heading/score footer | Strong for CQ WW SSB | Strong functional match to pp. 295–305 | Not pixel-identical; N1MM has a wider shortcut/action surface. Live Flex readback remains operator check. |
| Check Partial / SCP | Log, Master, Telnet and Call History panes; character-difference highlighting; real MASTER.SCP; event-driven stable updates | Strong | Strong functional match to pp. 285–289 | N1MM has additional pane hiding/proportion, yank ordering and reverse-history controls. |
| Log Display | Chronological and partial panes; contest columns; multiplier/points marks; DUPE badge; resizable persistent columns; adaptive rows and paging; inline/full editing and export | Strong CQ WW parity | Strong functional match to pp. 342–346 | N1MM adds drag reorder, richer sorting/bulk/X-QSO tools and exact warning colors. |
| Cluster | Full calls; Band, PTS, CQ, multiplier and comment columns; band filter; Needed Qs + Mults / Mults only; Show worked; fitted rows/paging; click-to-draft/tune path | Strong CQ WW opportunity parity | Strong functional match to Available Mults & Qs pp. 267–271 | N1MM adds more sort combinations, SO2R focus, SNR/sunrise/preferred-spotter and right-click actions. Live tune not exercised. |
| Band Map | Full calls, contest colors, worked hidden by default, band/mode filters, contest phone/CW/data segments, zoom/pan/age controls and click-to-draft/tune path | Strong | Strong CQ WW match to pp. 272–284 | N1MM adds RIT/XIT, programmable radio controls, SO2R maps and broader shortcuts/actions. |
| CQ WW colors | Blue valid QSO; red one multiplier; green double multiplier; gray worked/dupe | Match | Match to Available p. 270 and Band Map p. 275 | User-configurable color themes are broader in N1MM. |
| Contest band plans | Contest-owned phone/CW/data segments drive classification and visible ranges; disabling CW/data leaves phone | Match for requested contest | Match to pp. 275–277 | N1MM interactive per-frequency plan editing is broader. |
| Stats / score | Per-band QSO, PTS, ZN, CTY and claimed score | Strong core match | Core match to Score p. 367 | N1MM offers copy/print and a dedicated visible Rescore button. |
| DXCC / Zone | Separate per-band country and CQ/ITU zone matrices with current-target highlight | Strong core match | Partial match to Multipliers pp. 349–354 | N1MM has richer availability/expected/spotted grids and clickable blocks. |
| Rates | Last hour/10/100, current clock hour and Run/S&P totals/splits | Strong data match | Partial visual match to Info pp. 334–336 | N1MM integrates graphs/goals; xLog uses a dedicated table/text window. |
| Callsign Details | Callsign, Name, Country, QTH, Grid, Continent, ITU zone and CQ zone only | Intentional requested subset | Closest analogue is Info pp. 333–335 | Deliberately not a full N1MM Info window. Missing lookup data shows `—`. |
| Messages | All contest diagnostics centralized; no banners in Main Logging/other operating windows | Intentional xLog policy | Difference from Info/status behavior | Truthful diagnostics remain available only when the operator opens Messages. |
| Setup/dialog routes | Setup, Operator, Station, Configuration, Digital, Macros, Keys, Rover, About and retained service routes | Broad retained route parity | Not a one-window N1MM clone | All-contest and external-service acceptance is intentionally outside this freeze. |
| Rotator / Remote VFO | Separate safely owned windows; opening never selects a provider or moves hardware | Functional, nonblocking | Partial | No final commanded rotor motion or live VFO tune/readback. Rotor is unnecessary for the planned 40 m vertical. |
| Main xLog recovery | `Open xLog Main Window` restores the normal desk while contest windows remain available; logging owners remain exclusive | Safer ownership boundary than upstream | xLog-specific | Module-switch items were source/lifecycle tested, but one accessibility menu snapshot did not enumerate them. |

The expected Contest menu routes were visible in the installed app: Import or
Transfer, Setup, Operator, Station, Configuration, Digital, Macros, Keys, Rover,
Call History, Callsign Details, Group Chat, Main Logging, Stats, Logbook, Band
Map, Cluster, Check Partial, Rates, Score Reporting, Messages, DXCC, Zone,
Rotator, Remote VFO and About.

## Not1MM parity assessment

**CQ WW SSB operational parity is strong.** The original Python/SQLite host owns
the contest rule/plugin behavior. The macOS workflow now provides the windows
and data flow needed for one-operator CQ WW SSB: entry, RS + CQ zone, per-band
country/zone scoring, duplicate handling, SCP, log/edit/export, cluster and Band
Map opportunity semantics, rates/statistics and restart recovery.

**Complete Not1MM parity is not claimed.** Registration or source support for a
broader contest/plugin catalog does not prove every contest, every window and
every upstream interaction in an installed app. Multi-Mac live reconciliation,
external digital applications, all macro/CAT syntax, scoreboard service use and
recorded-voice hardware behavior remain separate scopes.

## N1MM Logger+ manual assessment

The supplied manual confirms that the implementation follows the important CQ
WW operating semantics:

- Available/spot colors are green double multiplier, red single multiplier and
  blue valid QSO (p. 270); Band Map adds gray dupe (p. 275).
- Band Map sub-band limits determine mode classification and should vary by
  contest (pp. 275–277); the xLog contest band-plan owner supplies those
  phone/CW/data segments.
- The Check window is pane-based and supports Log, Master, Telnet and Call
  History data (p. 288); xLog implements those four requested panes and clean
  responsive distribution, without every right-click/yank option.
- The Entry footer separates country/zone information, QSO/multiplier totals and
  score (p. 300); xLog now uses the same information hierarchy without putting
  diagnostics or optional-voice warnings there.
- The Log marks multipliers and supports editing (p. 343); xLog additionally
  rescales and republishes authoritative score state after supported edits.
- N1MM's Multipliers window is substantially richer (p. 350). xLog has useful
  DXCC/Zone matrices but is still partial here.
- The Score window is a contest-formatted band/QSO/point/multiplier summary
  (p. 367); xLog's CQ WW Stats provides the corresponding core data.

The correct wording is therefore **strong functional match for CQ WW SSB**, not
an exact N1MM clone.

## What remains to finish

### Minimal operator-controlled check before the contest

1. Connect the intended Flex.
2. Confirm that Main Logging shows the authoritative current frequency, `40 m`
   band and `SSB` mode.
3. Optionally select one known safe Cluster/Band Map spot and verify that the
   intended radio alone changes to its frequency/mode. This requires an explicit
   operator action and was intentionally not performed during acceptance.

### Optional or deferred, not blockers for manual-microphone logging

- Record and validate F1–F12 WAV files, select/verify output routing, then test
  PTT and actual transmitter audio/RF as four separate operator-controlled
  results. Macro substitution alone is already tested.
- Public notarization/stapling if this local candidate is to be distributed.
- Credentialed real-time scoreboard posting.
- Simultaneous two-Mac multi-operator logging/chat/reconciliation.
- Rich N1MM multiplier availability charts, rate graphs, advanced column
  reorder/sort/bulk log tools, SO2R/SO2V behavior and broader right-click menus.
- Windows/Linux package and installed-app acceptance. Exact-source portability
  run `39918699201` passed both macOS jobs, both Ubuntu jobs, the Windows broad
  contest job and definition generator. Its Windows native job failed only in
  `persisted_selection_binds_the_next_worker_generation_after_restart` because
  syncing the operating-module preference directory returned Windows error 5,
  `Access is denied`; this macOS freeze does not call Windows passed.
- Broad installed acceptance across every registered Not1MM contest/plugin.

No further parity or feature batch should begin until the operator reviews this
report and supplies the next priorities.

## Rollback

The retained signed rollback is
`/Applications/OM0RX-xLog-previous-20261024T041656Z-59790.app` from source
`8f89e860e3839803b2d359894bec225bc96f75a0`. The final installed candidate and
rollback both pass deep/strict signature verification. Logbook and installation
backup directories were retained and were not part of cleanup.
