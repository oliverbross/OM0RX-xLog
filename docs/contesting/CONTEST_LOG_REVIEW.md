# Contest Log Review

An on-demand review of the active contest, available through **Contest → Log Review**
in the next candidate. It reads the actual Python/Not1MM contest log and the existing
separate `spot-history.sqlite` archive. Scanning is read-only; an explicit callsign
correction uses the existing audited host correction path. It sends no radio commands.
Received spots are already archived by the cluster service; this feature reuses that
path without adding review work to entry, DUPE checking, saving or spot delivery.

## Use after operating

1. Open the contest to review, then **Contest → Log Review**.
2. Choose time and frequency tolerances and click **Run review**. No scan runs merely
   because the window is open. The default comparison is ±5 minutes and ±2 kHz;
   exact-call mismatches are searched within ±60 minutes.
3. Filter **Possible typo**, **Frequency/time mismatch**, **Country / zone mismatch**,
   **Reviewed**, or **All**. Select a finding to inspect its original QSO and evidence.
4. Use **Original report** to read the archived cluster text. Keep the logged contact
   or dismiss the suggestion to record a review decision. These do not change the log.
5. Read the **Logged contact / Reported suggestion** comparison. A possible typo with
   exactly one candidate offers **Change callsign to …**. This changes only the
   callsign input; received exchange, timestamp, frequency, reports and notes remain
   intact. Country, duplicate status, score and multipliers follow the existing host
   recalculation. Multiple candidate calls require manual verification.
6. **Open Log Display** searches for the logged call and highlights this exact QSO ID,
   including when the call occurs more than once. Click its call to use Edit Contact.
   Log Display also has an independent full/partial **Search callsign** field, **Search**
   and **Clear search**, with paging over matching contacts. It never fills the live
   contest entry. Search supports up to 20,000 contacts, at a consistent log revision.
7. Run review again after a correction. Old results are disabled after a correction
   attempt, including an uncertain completion; stale revisions and changed contacts
   are rejected. Save/cancel an open editor first. Finish a pending live entry before
   applying a review correction; shared contest clients use Edit Contact.
8. **Copy report** copies a JSON report containing the snapshot revision, source
   fingerprints, tolerances, suggestions and decisions.

Decisions are local to the contest/workspace and apply only to unchanged contacts
and supporting evidence. Closing the window cancels the current scan. Cancellation keeps
previous results and has no partial QSO changes to roll back.

The Cancel button cancels scanning, not an explicitly submitted correction. A submitted
correction has a native at-most-once receipt; after a timeout, inspect the log and rerun
review before retrying. Report suggestions remain evidence for the operator to verify.

### Search and correction validation — 26 October 2026

- Focused frontend coverage: 493 tests across review, comparison, selection, protocol,
  detached windows and the Python contest desk (492 in the broad pass plus the corrected
  canonical-timestamp fixture passing separately).
- Exact-ID navigation among repeated calls and beyond the first 100 contacts; search
  and paging leave the live callsign unchanged. Ambiguity uses all candidates before
  supporting reports are truncated.
- Disposable real Python-host correction preserves exchange, UTC, TX/RX frequencies,
  reports, operator, power and notes; correction survives restart and stale writes fail.
- TypeScript compilation, native review admission and 34 native surface tests pass.
- Browser previews visually checked for the comparison/correction and exact-contact
  highlight with the search controls. These source checks do not
  edit the production log or establish installed-app acceptance.

## Local reference evidence

- **Bundled CTY:** resolved country/DXCC and suggested CQ zone, including portable
  calls and supported dated exceptions. Compares the log's country prefix and CQ WW
  received exchange. Other contests' serial numbers are not interpreted as CQ zones.
- **Cached Club Log country data (`cty.xml`):** an independent country/zone resolution
  at the QSO's UTC date. Disagreement with CTY is reported for inspection. This is
  country data, **not a Club Log user directory**; no membership claim is made.
- **Cached LoTW activity list:** exact full-callsign membership, including suffixes.
  “Not listed” is inconclusive and never creates an invalid-callsign finding.

The source panel shows available/missing/invalid status, file modification time where
available, and SHA-256 fingerprints. Modification time is not a provider publication
date. Review does not download files, call QRZ/LoTW/Club Log online, or update datasets.
An absent/invalid optional file does not block bundled CTY or spot comparisons.
No SCP-membership or Club Log-user-directory comparison is implemented in this version.

## Interpreting results

Spots can be mistyped, delayed or copied, and stations can move or operate split.
A missing spot does not make a QSO invalid. Nearby one-character edits/transpositions
are suggestions; portable prefixes and suffixes are not silently equated. Either
logged RX or TX frequency can corroborate split operation. Repeated reports do not
increase a confidence score. Locally generated heard/logged overlays are excluded
from independent spot evidence. Operator-supplied CQ zones can legitimately differ
from prefix defaults, especially in countries spanning several zones.

The snapshot is pinned to the active contest, log revision and reference versions.
If these change during collection, rerun review. Reads use bounded pages; comparison
runs in a separate browser worker. No continuous background comparison is installed.

Coverage is limited to retained received reports. The window discloses recorder gaps,
missing reported times, invalid records and truncation. It reads reports arriving
between one day before the earliest QSO and one day after the latest QSO; comparison
uses the report's UTC time. First-version limits are 20,000 QSOs and 50,000 archived
reports per run. It cannot reconstruct earlier uncaptured or pruned spots.

## Validation record

Source validation uses disposable fixtures, never production contact mutations:

- Comparison, references, acquisition, UI and window routing: 65 frontend tests.
- Native read-only method/window admission and non-retiring read timeout behavior.
- Swift local-reference parsing, dated resolution, exact membership, missing/invalid
  files, cache invalidation and source fingerprints, plus real LiveWorker routing
  in an isolated Contesting Test workspace: 10 tests. External services remain
  blocked, and source reference bytes and logbook records are unchanged.
- TypeScript/Vite production build and bundle graph verification.
- Browser rehearsal with the real comparison worker: typo and country/zone results,
  evidence selection and raw report display, decisions retained after reopening,
  and 680-pixel-wide layout.
- Independent review found and fixed malformed calls aborting a reference batch;
  valid contacts now remain reviewable and malformed rows are counted separately.

These checks are not installed-app acceptance. Exact release source, packaged
Python acceptance and installation status belong in the release acceptance record.
