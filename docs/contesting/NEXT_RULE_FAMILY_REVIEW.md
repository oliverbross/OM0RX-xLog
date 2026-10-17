# Next rule family review

Reviewed 18 October 2026. These are implementation requirements, not accepted
contests or a bundled reference pack. Existing rule identities stay unchanged.

## NAQP CW, SSB and RTTY

The [NCJ contest page](https://ncjweb.com/naqp/) currently links to
[2026 rules](https://ncjweb.com/NAQP-Rules.pdf), despite a search result labeling
that URL as 2024. Inspect the document itself when pinning an implementation.

- The North American definition includes Hawaii. NA entrants exchange a name
  and location; other entrants exchange a name. DX is used in the log's
  received-location field for non-NA contacts.
- Multipliers are the 50 states, DC, 13 Canadian provinces/territories and
  other North American DXCC entities, counted per band. Other NA entities use
  their standard DXCC prefix as the logged location.
- A valid contact needs a North American endpoint; duplicates are per band.
  Score is valid contacts times the sum of band multipliers.
- CW/SSB use 160–10m contest bands; RTTY excludes 160m. Signal reports are
  absent from this exchange. The rules also define category, power, operating
  time and assistance restrictions that need separate acceptance coverage.

The linked [Cabrillo example](https://ncjweb.com/NAQP_Cabrillo_Template.txt)
contains 2014 contacts. Use it for field layout, not as evidence that every
historical location value conforms to the 2026 rules. In particular, its HI8
row uses DX, while the current rule specifies a country prefix for other NA
entities. Golden fixtures must resolve that difference explicitly.

## ARRL RTTY Roundup

The [ARRL contest page](https://www.arrl.org/rtty-roundup) links to
[rules version 3.0b](https://contests.arrl.org/ContestRules/RTTY-RU-Rules.pdf).
The current mode is RTTY only, logged as RY in Cabrillo; older digital handlers
in the pinned Python program do not establish current FT8/FT4 eligibility.

- W/VE exchange a report and state/province; DX exchanges a report and serial
  beginning at one. This is an entrant-dependent sent-exchange policy.
- Each valid contact earns one point; duplicate checks are per band.
- Multipliers count once across the contest: US states plus DC, Canadian
  provinces/territories plus Labrador, and DXCC entities other than US/Canada.
  Alaska and Hawaii count as DXCC entities under this rule.
- Bands are 80, 40, 20, 15 and 10m. Category, operating-time, band-change,
  assistance and overlay rules require explicit enforcement or a disclosed
  preview limitation; scoring arithmetic alone is insufficient.

## Consequences for the port

1. Finish and review additive structured fields, report-free entry, exact mode
   validation and legacy receipt compatibility before adding these rules.
2. Port NAQP as a real multi-field family with a pinned location authority and
   independent NA/DX, Hawaii, per-band, duplicate and export fixtures.
3. Define an explicit station-resolved serial policy before RTTY Roundup.
   The current unconditional reservation policy cannot be presented as
   satisfying both W/VE and DX entrants. Avoid a generic expression language.
4. Pin the official multiplier source and its digest before enabling a rule.
   Keep source-plugin comparisons distinct from corrected current-rule
   behavior, and bind that behavior to a new immutable rule identity.
5. Integrate worker descriptors, UI tab order, import/export and simulated
   operator scenarios before recording either family as operational.
