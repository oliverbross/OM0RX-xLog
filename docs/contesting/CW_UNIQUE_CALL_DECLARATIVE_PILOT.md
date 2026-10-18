# Shared CW Unique-Call Declarative Pilot

This inactive pilot adds one reusable rule-policy combination for CWT, CW Open, and ICWC MST. It does not add contest-specific Swift rule classes or activate any definition in the catalog.

## Shared executable contract

All three definitions use CW on 160, 80, 40, 20, 15, and 10 metres; one point for a valid contact; duplicates per band; one multiplier for each distinct callsign in the session; and `points * multipliers`. Their described exchanges do not include signal reports, so the shared mode profile requires empty report fields and rejects fabricated RST values. Callsigns are normalized by `ContestQSO` before duplicate and multiplier keys are formed. The multiplier key is typed as `kind=callsign`, `scope=session`.

CWT uses typed name plus a member-or-location field. The second field accepts a nonnegative member number or bounded location text, including multiword DX locations. CW Open uses serial then name. ICWC MST uses name then serial. Both serial contests reuse the existing session-scoped durable reservation counter, start at `001`, and validate the allocated serial field against the reservation while validating the full structured aggregate independently.

The definitions are persisted through the existing canonical declarative-definition path. Their identities remain digest-bound to their exact bytes. The vocabulary addition does not change previously persisted 10-10 bytes; tests pin all four accepted 10-10 definition digests.

## Primary sources and pinned comparison

Primary rules snapshots read on 2026-10-18:

- CWT: <https://cwops.org/cwops-tests/>, SHA-256 `d98a97401dee2cf8106efb1756b78875ce900024715b3bebb19ef2919c646056`
- CW Open: <https://cwops.org/cwops-tests/cw-open/>, SHA-256 `b73265ece8bc6e6d6e874a108ddf7ec1e2808c3d9fbdffd3b7380cd30629685a`
- ICWC MST: <https://internationalcwcouncil.org/mst-contest/>, SHA-256 `c594f23f513853a42c0644fb8243e5d24700b7a381a2611bc2dd44b862fef289`

The comparison corpus is `contest-sw` revision `7c8b499225a73f7f8f792246881bd7aefc05452f`. The exact plugin hashes are recorded in each definition and in `compare_cw_unique_call.py`. The comparator verifies each hash, parses the module without importing it, extracts only `points`, `show_mults`, and `calc_score`, rejects unreviewed calls and side-effect constructs, and executes those functions against a fake in-memory database. It confirms the source implementation's `1/0` accepted/duplicate points, unique-call count, and `points * multipliers` result. This is a bounded comparison of those reviewed functions, not plugin-level semantic parity. In particular, the declarative typed CW Open exchange avoids the pinned Python one-token `parts.isalpha()` list bug.

## Activation gates

All three definitions keep export unsupported and remain absent from the active catalog. Activation requires reviewed event windows, entry categories, Cabrillo projections, submission/adjudication behavior, and representative operator runs.

CWT still needs the current conditional member/nonmember exchange and reporting particulars represented beyond the accepted field shape. CW Open needs three separate session windows, category handling, separate Cabrillo output per session, duplicate retention in submitted logs, and combined-score calculation as the sum of each session score. Serial numbering resets at `001` for each separate session. ICWC MST needs regional frequency limits and the exact running-station restriction around 7030 kHz (7030 +/- 0.5 kHz, maximum 5 W) represented and enforced.

No metadata observation is treated as proof of these unresolved semantics.
