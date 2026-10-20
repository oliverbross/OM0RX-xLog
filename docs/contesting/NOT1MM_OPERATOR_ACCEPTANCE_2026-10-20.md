# Not1MM operator acceptance — 20 October 2026

This checkpoint records demonstrated desktop behavior for the original executable
Not1MM Python/SQLite host inside xLog. It does not replace the continuing full-port
objective or treat unit tests as desktop acceptance.

## Candidate identity and installation

- Candidate version/build: `1.2.81`.
- Exact package source: `91624b1d21e58b8add33a52e3a5c3be0f1fdeeca` on
  `codex/not1mm-contesting`, with no recorded source changes.
- Both the production and isolated Contesting Test bundles embed Python 3.12.4,
  SQLite 3.46.0 and 92 packaged Mach-O components. Their relocation self-tests
  loaded the pinned contest catalog without package-manager libraries.
- `codesign --verify --deep --strict` accepted both bundles with Developer ID team
  `4WCMQ4U946`.
- The production bundle replaced installed version `1.2.74` at
  `/Applications/OM0RX-xLog.app`. The application data directories were not
  replaced or modified by installation. The temporary old app-bundle backup was
  removed only after the installed executable and signature were verified.
- The installed production executable's non-station acceptance mode passed all 35
  checks with `station_io: false`.
- Gatekeeper reports `Unnotarized Developer ID`; notarization is therefore still
  required before this candidate can be called a public macOS release.

Acceptance hashes:

- Production executable: `cee0aa3f1c654bb98160ebebd097c969dcac1d78e0d9bbc54e4805a4b25248b9`
- Production Swift worker: `f2915943800d2842a0ff82f69a69f1f41a1270b31e5b548b5b7ad47a931be3a3`
- Production Python runtime manifest: `f1eaec0b65fbe528fb17aa7de2db92707971a16cf644f59602a9506c92a14bfb`
- Contesting Test executable: `6c5c15668c02bce0d7abb1015f29185818cbb5c4a8d70daa94515b605aee5f41`
- Contesting Test Swift worker: `98ac6c7ab2fbabc760349409953d2a007d19bc3a53ef57a2ccee5e3f74d43502`
- Contesting Test Python runtime manifest: `e4f7b8b34caa9ba9e8f7dbe2e7732a03ea1e13b5ea634f5ff5afca06837427b6`

## Actual packaged desktop behavior

The complete disposable workflows below were performed in the signed Contesting
Test application, using separate native windows and the profile's nontransmitting
facilities.

### CQ WW SSB

- Created a CQ WW SSB contest with operator `OM0RX`, CQ zone 15 and manual
  14.250 MHz.
- Main Logging displayed the Not1MM-derived SSB fields, Run/S&P control and
  xLog-styled macOS window controls.
- Logged synthetic contact `VK8ZZZ`, corrected its received zone from 30 to 29,
  and observed Stats update to one QSO, one callsign, one phone QSO, one WPX
  prefix and three displayed points.
- Native Cabrillo export produced `/tmp/CQ-WW-SSB-1.2.80-34b0971d.log` with
  `CONTEST: CQ-WW-SSB`, the corrected zone and claimed score 6.

This complete workflow was demonstrated in packaged version 1.2.80 from source
`34b0971d6acef6cdc83baf3c3b0d7df5177ec480`. Version 1.2.81 changed the candidate
identity and explicit cluster digital-comment aliases; it did not change this
logging, correction, scoring or export path.

### CWT/SST name workflow

- Created a CWT contest with sent exchange `OLIVER 1234` and manual 14.035 MHz.
- Saved a CW profile, restarted the actual application, restored the contest and
  confirmed the visible `CONTESTING TEST` no-RF/no-audio/no-PTT banner.
- Verified Run/S&P and Tab focus order through Callsign, Name and Number/State.
- Logged `K1AAA / ALICE / 1234` and `K2BBB / BOB / 5678` using Enter/ESM.
- The draft Name and Number/State fields cleared for each next QSO.
- Corrected the second received Name from `BOB` to `ROBERT`. The first historical
  contact remained `ALICE`, and both historical sent exchanges remained
  `OLIVER 1234`.
- Log Display showed both QSOs and score 4. Cabrillo export at
  `/tmp/CWT-1.2.80-34b0971d.log` retained the corrected and historical exchanges.
- F1 was admitted and claimed through the nontransmitting output path. macOS
  intercepted the attempted physical F3 key during this run, so F3 keyboard
  delivery is not claimed by this evidence.

After installing the exact 1.2.81 Contesting Test bundle, it was launched from
the package path, the saved CWT session was reopened through Contest Setup, and
Main Logging visibly restored the two QSOs, score 4, separate-window geometry and
nontransmitting CW simulator.

## Review findings

The findings from the independent `6f308695` review were rechecked against the
current source. The following are now connected and regression-covered:

- Main Logging owns and receives admitted CW, Enter/ESM and focus commands.
- CWT/SST received Name is editable, clears for the next contact and does not
  rewrite unrelated historical sent exchange data.
- Setup rejects an invalid sent exchange atomically.
- WPM targets the selected radio owner.
- Call History retry is admitted by the native command boundary.
- Spot-selection failures return to the originating detached window.
- Edit Keys uses bounded saved tuples and executes the supported action set.
- Log queries and exports are no longer limited to the first 100 contacts.
- Buffered entry and current radio frequency survive the worker/owner handoff.

## Additional connected checks

- Official Super Check Partial download succeeded into a disposable cache; the
  active SCP cache was not overwritten by that test.
- Explicit spot-comment evidence now overrides misleading frequency inference
  for bounded digital aliases. For example, a 28.088 MHz comment containing
  `FT-8` is classified as data rather than CW. FT8/FT-8, FT4/FT-4, RTTY, PSK,
  PSK-31, JT65/JT-65, JT9/JT-9, DIGITAL and bounded DATA aliases are covered,
  including precedence and false-positive tests.
- The full clean pre-package baseline passed 150 Python tests, 3,688 frontend
  tests, 737 production Rust tests, 743 Contesting Test Rust tests and the
  portable Swift suites. The focused expanded digital-classifier suites also
  passed.

## Work after this installed candidate

Commit `f2e32988` follows the 1.2.81 package source. It adds a Contesting-Test-only
CQ WW SSB intent simulator that exposes F1-F12 and Enter/ESM, requires explicit
arming, validates and atomically claims authentic Python `voice_keyer` actions,
and calls no CW, audio, PTT, RF, radio, station-tune or network output. Production
CQ WW SSB remains fail-closed before worker mutation. This newer commit passed
3,692 frontend tests and the production frontend build, but is not present in the
installed 1.2.81 package and still requires a new packaged-app acceptance run.

## Exact remaining limitations

- Notarization is incomplete.
- No physical RF, voice playback, PTT, radio, amplifier, tuner or rotor action was
  exercised. The test profile intentionally disables those paths.
- Production SSB voice-keyer output has no accepted native audio/PTT authority;
  no such behavior is claimed.
- WPX and Sweepstakes have strong Python-host tests but still require their full
  packaged desktop workflows and phone-intent connection.
- The executable catalog contains 21 pinned original plugins, not the complete
  Not1MM catalog. Remaining plugins, configuration windows and workflows are
  continuing work, not deferred product scope.
