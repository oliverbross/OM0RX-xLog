# Four-pilot operator scenarios

`Tests/XContestCoreTests/SourceFixtures/four-pilot-operator-oracles.json` is the
machine-readable acceptance input for the CQ WW and CQ WPX CW/SSB source-derived
pilots. It is independent of the Swift rule engine: expected points, duplicate
dispositions, multiplier keys and prefix results were derived from the pinned
Python source. The lifecycle and persistence expectations additionally define
the behavior xLog must prove; they are not claims about the Python application's
storage model.

## Pinned authority

The read-only source checkout is `oliverbross/contest-sw` at
`7c8b499225a73f7f8f792246881bd7aefc05452f`. The fixture records these exact
SHA-256 values:

| Source | SHA-256 |
| --- | --- |
| `not1mm/plugins/cq_ww_cw.py` | `08f383e8ddb6f02fede9149f5490a1042b71a5cd5e2591ac76b0cf1ba460c3e2` |
| `not1mm/plugins/cq_ww_ssb.py` | `9ec3762986761232042389f0334b4887271772d18025f3dd0fdc820782105b3b` |
| `not1mm/plugins/cq_wpx_cw.py` | `27551aab291943acc03b53c74773b8da8ad3c5cbeb96dc6e483870408eadbc86` |
| `not1mm/plugins/cq_wpx_ssb.py` | `7d76fc6506c9fa4599db7ba1ea1e609a42994c79fc77096fbb522a7cb129f10d` |
| `not1mm/lib/ham_utility.py` | `dd6261db3aa528cf1c13fdaaf7c1816106e2dfa33ff15c45c2a2fd5e0356adb2` |

All four rule identities use version `1.0.0-source-spike`, edition
`source-26.10.11`, and that exact source revision. The SSB identities are
`cq-ww-ssb` and `cq-wpx-ssb`; the existing CW identities remain unchanged.

## Fixture shape

The fixture deliberately uses plain records rather than a general rules DSL.
Each of its four operator scenarios contains:

- the complete rule identity and entry descriptor expected from the catalog;
- a fixed OM0RX station/operator snapshot and explicit synthetic entity data;
- chronological Run and S&P contacts with reports, raw exchanges, band,
  frequency, mode and expected WPX prefix where applicable;
- initial, post-correction, post-deletion and clean-restart checkpoints;
- exact point, multiplier, score, duplicate-promotion and serial expectations;
- Cabrillo and ADIF record-level expectations before mutations and after the
  final restart.

The Run/S&P labels specify both operator entry paths for a future integrated
harness. This fixture does not execute those paths. The pinned arithmetic does
not award different points based on Run versus S&P, and the fixture does not
imply ESM, transmit, RF or radio-control behavior.

## Expected operator results

The WW scenarios log six initial contacts. Same-call/same-band contacts become
duplicates, while the same callsign on 40 metres receives separate credit.
The set covers same-country zero-point multiplier credit, same-continent
one-point credit and intercontinental three-point credit. The initial total is
5 points and 8 band-scoped country/zone multipliers, for 40 points.

Correcting the first German contact to France promotes the later German
same-band duplicate. France adds one country multiplier while CQ zone 14 was
already present, yielding 6 points, 9 multipliers and 54 points. Deleting the
first US contact promotes its later duplicate without changing the total. A
clean restart must retain the five live contacts, correction, tombstone,
promoted credit and exact mutation replay result.

The WPX scenarios reserve and commit serials `001` through `007`. They cover
same-country, same-continent, intercontinental, high-band and low-band point
branches, same-band duplicates, cross-band QSO credit and contest-wide prefix
multipliers. `K1ABC/4` must resolve to `K4`; the independent prefix cases also
cover `OM/K1ABC/P -> OM0` and `EA8/K1ABC/P -> EA8`. The initial total is 14
points and 4 prefixes, for 56 points.

Both WPX entry descriptors require an operator serial and allow session, band
and transmitter reservation scopes, in that order. They advertise numeric
ADIF `STX`/`SRX` fields. WW requires no serial reservation and advertises no
numeric ADIF exchange fields.

Correcting the first `K1ABC` to `N2XYZ` adds prefix `N2` and promotes the later
20-metre `K1ABC`, yielding 17 points, 5 prefixes and 85 points. Deleting the
first `DL1AAA` promotes its later duplicate without changing that total.
Serial `003` remains issued and is never reused; after restart the next serial
is `008`.

The source-derived arithmetic determines which corrected or undeleted contact
receives credit. Durable correction records, deletion tombstones, serial
nonreuse across restart and exact mutation replay are xLog acceptance
requirements layered on that arithmetic.

The independent arithmetic table also isolates the North American CQ WW
two-point exception and the WPX North American high/low-band two/four-point
branches. Those cases use a synthetic US station and Canadian contact so they
do not depend on the OM0RX lifecycle scenario.

## Export expectations

The pre-mutation artifact retains every QSO line or ADIF record, including
zero-credit duplicates. The post-restart artifact excludes the deleted QSO and
uses the final score. Cabrillo uses `CW` for CW and `PH` for SSB, with CRLF line
endings. ADIF uses `MODE=CW` or `MODE=SSB`, preserves raw leading-zero exchange
text, and emits numeric `STX`/`SRX` only for the two serial-number WPX pilots.
The fixture defines record counts, contest IDs, claimed scores and inclusion
rules; byte-for-byte formatter goldens remain a separate implementation test.

## Acceptance boundary

These are source-derived preview oracles, not current sponsor certification.
They do not validate event dates, operating-time limits, category eligibility,
power, assistance, station geometry, remote operation or edition-specific
Cabrillo enums. Synthetic entity snapshots avoid a live lookup; the integrated
harness must verify that its pinned CTY reference resolves the same coordinates.
Restart means an orderly close and reopen. Crash recovery, platform packaging,
foreground UI operation and RF/hardware evidence remain separate gates.
