# Wave 2 operating rules: source and evidence scope

Verified against sponsor sources on 2026-10-27. Source identity is an edition, category and document URL, not the computer's current year. These sources establish the narrow implemented timing rules; they do not establish overall category compliance.

## Supported profiles

The **2026 CQ WPX CW/SSB** profiles require deliberate profile adoption, matching saved category and the official start UTC. CW is May 30–31; SSB is March 28–29. Each period is 48 hours, represented with an exclusive Monday 00:00 UTC endpoint.

- `wpx-2026-single-op`: SINGLE-OP, ALL or an explicit single band, no overlay. The limit is 36 hours, with at least 60 consecutive empty clock minutes for a qualifying log break. Reconstruction covers the first through last occupied QSO minute; short breaks remain operating minutes. The open tail is separately labeled inferred inactivity. Other-band logged QSOs remain activity evidence; no band-change recommendations are made.
- `wpx-2026-multi-one`: MULTI-OP, ONE transmitter, ALL bands, no overlay. Ten band changes per UTC clock hour. Each first QSO on a different band counts in its new UTC hour; returning to the prior band counts again. Mode-only changes do not count.

Primary source: [2026 CQ WPX rules, sections II and VI](https://cqwpx.com/rules/2026_cqwpx_rules.pdf), explicitly dated 2026. The [HTML rules](https://cqwpx.com/rules/) show an inconsistent 2025 SSB year despite their 2026 heading; the dated PDF supplies the event dates used here. The [sponsor FAQ](https://cqwpx.com/rules_faq.htm), consulted 2026-10-27 (no publication date supplied), clarifies empty clock minutes and attributes band changes to the first QSO on the new band. A QSO at 09:00 followed by 10:00 has only 59 empty minutes; 10:01 provides 60.

## Evidence limits and deferred profiles

An identified source means the rule is verified, not that an entrant is compliant. Band counters report QSO observations, not all transmissions. Unknown bands or simultaneous differently banded QSOs break ordering continuity and yield explicitly incomplete lower bounds. Invalid, future and out-of-period records are counted as exclusions. Corrections, deletion and imports recalculate from current scoped rows without rewriting them.

The app has no persisted authoritative operating/style/operator/lane interval observations in this scope. Their durations remain unavailable (`null`), including for historical logs. Run flags, QSO gaps, operator plans, rest notes, PTT requests and client-provided interval claims do not create observations. Receiver and TX activity remain unknown. Inactivity never proves an idle receiver or a verified off-air period.

[CQ WW 2026 rules V.C.1](https://cqww.com/rules/) and the [sponsor Multi-Single FAQ](https://www.cqww.com/rules/faq.htm) were checked as candidate sources. They require independent ten-minute clocks for functional run and multiplier signals, beginning with first QSOs; the FAQ interprets time using logged whole minutes. Physical radio identity is not sufficient to assign a functional signal. This implementation deliberately leaves CQ WW Multi-Single unverified because the scoped QSO records lack trustworthy run/multiplier signal attribution. It also does not support WPX RTTY, Classic/other overlays, Multi-Two, NAQP, other editions or generic contest profiles.

## Validation

Focused Python fixtures independently cover 59/60/61 empty minutes; 2159/2160/2161 reconstructed operating minutes; 9/10/11 band changes; UTC midnight attribution; mode-only changes; ambiguous ordering and unknown bands; correction/deletion/import; no mutation; explicit edition/category selection; single-band scope; UTC offsets; and invalid/future/outside evidence. UI fixtures check explicit source display, missing observations, scope/revision requests, stale session response rejection and deliberate plan adoption. These are log calculations and UI checks; no RF/PTT or receiver observation is claimed.
