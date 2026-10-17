# ARRL International DX CW and Phone port contract

Status: frozen for Astra review on 18 October 2026. This is an implementation
and acceptance contract for the full contest family, not product code, an
accepted preview, packaged-app evidence, RF evidence, or a sponsor-ready log
claim. Nothing in this document changes an existing immutable rule identity.

## Scope and authority

The port covers the two separately scored events:

- `ARRL-DX-CW`, CW only, on 160, 80, 40, 20, 15, and 10 metres;
- `ARRL-DX-SSB`, Phone only, on the same six bands. Cabrillo QSO mode is `PH`.

The current sponsor authority linked by the ARRL contest page is **ARRL
International DX Contest Rules, Version 2.0**, dated 4 January 2024. The page
still linked that document when checked on 18 October 2026. Rules, multiplier
lists, and current DXCC eligibility are primary authority. The pinned Python
plugins are read-only compatibility comparators, not rule authority.

The exact retrieved authority bytes are deliberately recorded so a later rules
refresh cannot silently change an existing session:

| Authority | URL | Local retrieval | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| ARRL DX Rules v2.0 | <https://contests.arrl.org/ContestRules/DX-Rules.pdf> | `/tmp/arrl-dx-rules-v2.0-2026-10-18.pdf` | 250769 | `bd87f1b3f635c4cd25c8d80f4b0ca06dca0a4a0f10c819289634492ae1fefee9` |
| United States contest multipliers v1.2.0 | <https://contests.arrl.org/contestmultipliers.php?a=usa> | `/tmp/arrl-contest-multipliers-usa-2026-10-18.html` | 5793 | `4d87d53ca04a5cc9e4439508c61a690d073c193477687743f929cb56d1b0a914` |
| Canadian contest multipliers v1.2.0 | <https://contests.arrl.org/contestmultipliers.php?a=ve> | `/tmp/arrl-contest-multipliers-ve-2026-10-18.html` | 4428 | `f7e617b05918c63aa568672b63d38b33bd7d6f784f2073a0fb4086f914037c1a` |
| Current ARRL DXCC entities | <https://www.arrl.org/files/file/DXCC/DXCC_Current.pdf> | `/tmp/arrl-dxcc-current-2026-10-18.pdf` | 156080 | `409d7f5842375468f559753c41c5569115fa57401d587aa4573829d275f92c2c` |
| ARRL contest-section guidance | <https://www.arrl.org/contest-sections-list> | `/tmp/arrl-contest-sections-list-guidance-2026-10-18.html` | 35066 | `d841c2faad5cc6b37d73a13289f5cd8fad2924b75ac701c5c3820b0aab812a6f` |
| Current ARRL/RAC section list v1.2.0 | <https://contests.arrl.org/contestmultipliers.php?a=wve> | `/tmp/arrl-contest-multipliers-wve-sections-2026-10-18.html` | 9535 | `5618ceeeb46494dd94313f32a9f33f2fd5a8d5be96693a502de5b147f927ebe6` |

The current DXCC bytes exactly match the January 2026 authority already pinned
for ARRL RTTY Roundup. Reuse its independently extracted 340-code authority and
its equality fixture; do not create a second hand-maintained country list.
The HTML multiplier bytes differ from the earlier ARRL RTTY fixture bytes even
though both pages still identify themselves as version 1.2.0 revised 12 May
2023. Bind new ARRL DX identities to the hashes above and compare semantic rows,
not an assumed shared HTML hash.

The official contest-section guidance says that these section abbreviations are
used for the Cabrillo `LOCATION` or `ARRL-SECTION` header in all ARRL contests.
This header policy is independent of the ARRL DX scoring side and on-air
exchange. Reuse the independently validated ARRL RTTY section policy and its
section-boundary evidence rather than deriving a header from a call prefix or
from the ARRL DX state/province exchange.

ARRL's 5 February 2020 Contest Update documents the sponsor's log-checking
normalization for common power abbreviations and CW cut numbers. The retrieved
page is `/tmp/arrl-contest-update-power-normalization-2020-02-05.html`, 76855
bytes, SHA-256
`8bbe551e561cd919c6d53e9bb58866303eb9106edf1b46b1a9ebbaad99863a80`.
It is useful compatibility guidance, but it does not supersede the current
rules. A current sponsor clarification or a newly published normalization table
requires a new immutable rule/reference version.

The comparator is `/Users/oliver/Documents/Projects/contest-sw` at
`7c8b499225a73f7f8f792246881bd7aefc05452f`:

| Plugin | SHA-256 |
| --- | --- |
| `not1mm/plugins/arrl_dx_cw.py` | `50dad8d13b4e782f6a846660f96a96357ae96866dac4ae5787f97818ed00e2d2` |
| `not1mm/plugins/arrl_dx_ssb.py` | `357f333526a8cda2f654c84245056cf47cc95bbb0be0c1add64b1e53c3474387` |

## Reuse boundary

ARRL DX must be an additive version-two structured rule family. Reuse, without
weakening, the existing contest infrastructure:

- immutable session/station/operator snapshots, full workspace UUID fencing,
  canonical request identities, typed receipts, strict timestamps, deterministic
  replay, checked arithmetic, and correction/deletion audit history;
- structured sent and received exchanges with raw and normalized values,
  report widths/defaults, station defaults, and optional ADIF mappings;
- the ARRL RTTY current-DXCC authority, station-side resolution, official US and
  Canadian location sets, and fail-closed entity handling;
- canonical callsign/portable-suffix duplicate handling, self-contact rejection,
  per-band duplicate keys, and stable timestamp-plus-UUID ordering;
- worker metadata validation, one operating-module owner, durable drafts,
  explicit uncertain-outcome recovery, Super Check Partial, and bounded call
  history suggestions;
- the export snapshot/service/cache/native-save contracts, CRLF Cabrillo output,
  ADIF output, exact hash receipts, and no-clobber publication.

The ARRL DX rule must not be selected by special cases scattered through the UI,
store, or exporter. Station-side policy, exchange fields, multiplier kind,
formatter policy, and category policy belong to its versioned metadata.

## Proposed immutable identities

Implementation review must choose final version strings, but the family needs
two distinct identities, for example:

- `arrl-dx-cw` / `1.0.0-official-preview` / an authority revision containing the
  rules, multiplier-list, DXCC, and power-normalizer hashes;
- `arrl-dx-ssb` / the same version and authority revision.

Both use a structured two-field exchange in each direction: signal report plus
one station-resolved field. Neither rule allocates a serial. CW admits only `CW`,
uses ADIF `CW`, Cabrillo `CW`, and default report `599`. Phone admits only the
product's bounded SSB modes, stores ADIF `SSB`, emits Cabrillo `PH`, and defaults
to `59`. The report remains editable and must satisfy the mode-specific width.

## Direction and geography

The lane resolves the entrant's physical operating endpoint before creating a
session and freezes one side:

- **W/VE** means a station operating from the contiguous United States or
  District of Columbia, or Canada. It is not inferred merely from a `K`, `W`,
  `N`, `AA`-`AL`, or `VE`-family call prefix.
- **DX** means every other current DXCC endpoint. Alaska (KL7), Hawaii (KH6),
  St. Paul Island (CY9), Sable Island (CY0), and US possessions and territories
  participate as DX stations.

The current DXCC authority must resolve both endpoints. Deleted, fabricated,
ambiguous, or missing entity codes fail before scoring or durable commit. A
portable callsign must agree with the frozen physical endpoint; for example a
KL7 call operating in Florida needs an entity-indicating modifier and a frozen
continental-US endpoint. The prefix alone cannot override the station snapshot.

A valid contact crosses the boundary exactly once: W/VE may contact only DX,
and DX may contact only W/VE. Same-side, unresolved, self, and cross-mode
contacts fail rule validation, earn no points or multipliers, and do not occupy
a duplicate key. `/MM` and `/AM` contacts outside the US and Canada may receive
contact credit under the general ARRL rules but cannot be given a DXCC
multiplier. Until xLog can freeze their physical endpoint, they remain an
explicit preview limitation and fail closed rather than using a home prefix.

## Exchange contract

### W/VE side

A W/VE station sends its mode-specific report and exactly one uppercase location
token. The accepted US set is the 48 contiguous state abbreviations plus `DC`;
`AK` and `HI` are not W/VE exchange tokens in this contest. The accepted Canadian
set is `AB`, `BC`, `LB`, `MB`, `NB`, `NF`, `NS`, `NT`, `NU`, `ON`, `PE`, `QC`,
`SK`, and `YT`. `LB` and `NF` are deliberately separate contest multipliers even
though modern civil geography treats VO1 and VO2 as one province.

The station's sent location is a required immutable station-exchange field. It
must agree with the station's frozen current entity and physical endpoint.
Received W/VE locations use the same list and must agree with the worked
station's resolved endpoint where the authority can prove that relationship.

### DX side

A DX station sends its mode-specific report and its power as one exact token.
Store both the bounded uppercase raw token and a normalized positive watt value;
power is never a serial, multiplier, category declaration, or inferred radio
telemetry. The configured station token becomes the immutable sent exchange and
must be preserved exactly on every QSO.

The current rules allow a number or abbreviation but do not enumerate every
abbreviation. The initial tested normalization table must at least cover decimal
watts and the official `K`, `1K`, `KILO`, and `KW` examples. Compatibility
fixtures should also cover removal of `W`/`WATTS`, cut-number substitutions
`A→1`, `E→5`, `N→9`, `T→0`, `O→0`, and the documented `000→1000` case. Inputs
that do not produce exactly one bounded value from 1 through 1500 watts fail
closed. Raw text remains available for correction, Cabrillo, and audit. Any
additional abbreviation needs pinned authority and a new reference version.

Drafts may hold incomplete text while the operator is typing. A commit requires
both reports, the station's exact sent exchange, the opposite-side received
exchange, resolved endpoints, an admitted band/mode, and a finite contest time.
History and SCP may suggest a location or power token but never establish its
validity or silently replace operator text.

## Contacts, duplicates, multipliers, and score

- Admitted bands are 160, 80, 40, 20, 15, and 10 metres.
- Each accepted nonduplicate contact is three points.
- The duplicate identity is canonical worked callsign plus band. The CW and
  Phone weekends are different rule identities, so mode is not a second key
  within either event. A repeated station on a new band is valid.
- Duplicate QSO rows remain in the durable log and export but contribute zero
  points and no new multiplier. Sponsor-applied busted/NIL penalties are log
  checking outcomes, not claimed-score deductions invented by xLog.
- Multipliers count independently on each band.
- A W/VE entrant counts each current DXCC entity except United States and
  Canada. Alaska, Hawaii, CY9, CY0, and eligible US possessions therefore count
  by their own current DXCC entity. Air/maritime mobile contact credit never
  creates a DXCC multiplier.
- A DX entrant counts each admitted contiguous-US/DC or Canadian location token
  once per band. Multiplier identity is the validated token, including separate
  `LB` and `NF`; arbitrary exchange text cannot become a multiplier.
- Claimed score is checked `3 × accepted nonduplicate QSOs × total band
  multipliers`. All additions and multiplication use checked arithmetic.

Edits, deletion, import, and replay recompute the whole deterministic result.
The first multiplier marker is display data, not authoritative scoring state.
Equal timestamps use the complete QSO UUID as the stable tie-breaker.

## Independently calculated cases

These expected values come from the published rules rather than either Python
plugin or a CW implementation reused as an SSB oracle. Run every arithmetic case
once with CW/`599` and once with Phone/`59`.

### W/VE entrant

A Connecticut entrant logs OM0RX (Slovakia), DL1ABC (Germany), KH6AAA (Hawaii),
and KL7AAA (Alaska) on 20 m; repeats OM0RX on 20 m; then works OM0RX on 40 m.
The five nonduplicate contacts produce 15 points. The four 20 m entities plus
Slovakia again on 40 m produce five band multipliers. Claimed score: `15 × 5 =
75`. The repeated 20 m QSO remains visible with zero contribution. A contact
with a Canadian or continental-US station is invalid, not a zero-point dupe.

### DX entrant

OM0RX logs `CT`, `NY`, `ON`, `NF`, and `LB` on 20 m, repeats the `CT` station on
20 m, then works it again on 40 m. Six nonduplicate contacts produce 18 points;
five 20 m locations plus `CT` on 40 m produce six multipliers. Claimed score:
`18 × 6 = 108`. A second different Connecticut call on 20 m raises points to 21
without adding a multiplier, so the score becomes `21 × 6 = 126`. `NL`, `AK`,
`HI`, and arbitrary `ZZ` exchanges reject. Working KL7 or KH6 also rejects for a
DX entrant because those stations participate as DX.

### Mutation and normalization cases

- Correcting a worked station from Germany to France replaces the affected
  entity multiplier after full replay; deleting the only Hawaii QSO removes
  both its three points and its band multiplier.
- `K`, `1K`, `KILO`, `KW`, and `1000` normalize to 1000 while preserving distinct
  raw text. An exact request replay returns the original receipt; changed raw
  text under the same request ID is a conflict even when normalized watts match.
- A same-band duplicate, invalid direction, invalid location, unresolved DXCC
  entity, forged sent field, or malformed report never consumes a serial because
  this family has no serial allocator and never advances score state on failure.

## Pinned-source parity and deliberate differences

The two Python plugins are nearly identical. They provide one combined
`Power/State/Province` entry box, per-band duplicate selection, direction-based
three-point scoring, per-band country or received-text multipliers, score and
multiplier totals, generic ADIF, Cabrillo, Run and Search & Pounce ESM paths,
and call-history prefill. The SSB file changes the name/mode/contest string,
uppercases its sent exchange during Cabrillo output, and carries a call-history
column marker. These are behaviors to cover, not evidence of correctness.

The current-authority implementation deliberately differs where the comparator
is incomplete or unsafe:

| Pinned comparator behavior | Required xLog behavior |
| --- | --- |
| Classifies the station and contact from CTY `primary_pfx` values such as `K` and `VE`. | Freeze current DXCC entity plus physical endpoint; handle KL7/KH6/CY9/CY0 and portable operation explicitly. |
| Accepts one untyped `NR` value and any configured `SentExchange`. | Publish typed station-resolved `location` or `power` fields and validate sent and received projections. |
| Counts every distinct received string as a DX entrant multiplier. | Accept only the pinned 48-state/DC and 14-token Canadian authority. |
| Counts a CTY country prefix as the W/VE entrant multiplier. | Count immutable current DXCC entity identity, excluding USA and Canada. |
| Can score a contact with a malformed or empty exchange once direction resolves. | Reject semantically invalid reports/exchanges before scoring or mutation. |
| A failed station CTY lookup can leave `query` or `mycountry` undefined. | Fail session creation or QSO validation with a typed, nonmutating error. |
| Interpolates contact data into SQL and derives first-multiplier state from prior timestamps. | Use typed repository queries and deterministic whole-log replay. |
| Does not enforce band, event mode/date, categories, assistance, power limits, band changes, or transmitter counts. | Enforce computable constraints and label operator attestations separately; disclose practice-mode limits. |
| Emits raw category values and a station ARRL section without sponsor-profile validation. | Validate versioned Cabrillo category enums and resolve `LOCATION` through the existing independently validated ARRL section policy, separately from contest-side classification. |
| Omits the transmitter identifier required for Multi-Two and can emit a mode inconsistent with the selected plugin. | Bind CW/Phone mode to the rule; require and validate transmitter ID where the category needs it. |
| CW and SSB differ in uppercasing the sent exchange. | Preserve raw exchange and apply the same documented normalization in both modes. |
| Generic ADIF/Cabrillo success implies no sponsor readiness. | Keep export goldens and sponsor submission acceptance as explicit separate gates. |

## Operator flow and recovery

Both rules need the existing contest field order: callsign, sent report, received
report, received station-resolved field, then the next callsign. The station's
location or power is visible but immutable during a session. Run Enter sends
call plus exchange and commits only after the received field is complete; Search
& Pounce sends the station call/exchange and commits by the same durable mutation
path. Corrected-call resend, `AGN`, `QSOB4`, CQ/QRZ macros, tab order, focus, and
history/SCP behavior require CW and Phone fixtures. Macro display is not proof of
CW keying or voice transmission.

Draft, QSO, edit, delete, restart, and uncertain-result recovery must preserve
raw and normalized exchanges, frozen entities, operator, band/mode/frequency,
UTC time, category/transmitter context, rule/reference versions, and canonical
request identity. No retry may create a second QSO. Switching to Normal Logging
and back retains both drafts and does not resume output intent.

## Cabrillo and ADIF

Add separate immutable formatter policies for CW and Phone. Each formatter
recomputes score from one frozen export snapshot and emits all submitted QSOs in
UTC order, including duplicates and out-of-entry-band contacts needed for log
checking. A single-band claimed score includes only the selected band.

Cabrillo requires `CONTEST: ARRL-DX-CW` or `ARRL-DX-SSB`, matching
`CATEGORY-MODE: CW` or `SSB`, and QSO mode `CW` or `PH`. Cabrillo `LOCATION` is
independent of the entrant's W/VE-or-DX scoring side and its state/province-or-
power exchange. Reuse the existing validated ARRL RTTY policy: continental-US
entity 291 needs its frozen ARRL section and cannot claim `AK`, `PAC`, `PR`, or
`VI`; Canadian entity 1 needs its frozen RAC section; Alaska maps to `AK`; Hawaii and
the validated current US Pacific-possession entities map to `PAC`; Puerto Rico
maps to `PR`; the US Virgin Islands map to `VI`; and every other entity uses
`DX`. Thus KL7, KH6, KP4, and KP2 participate on the DX scoring side and send
power while retaining `LOCATION: AK`, `PAC`, `PR`, and `VI` respectively. CY9,
CY0, and ordinary foreign entities use `DX`. The exporter does not infer any of
these values from the callsign or on-air exchange.

QSO exchange order is sent call, report, location/power, worked call, report,
power/location. The formatter preserves a validated raw power token when it fits
the pinned six-character Cabrillo exchange template. For an admitted seven- or
eight-byte raw power token such as `001500W` or `100WATTS`, it emits the already
validated canonical numeric value (`1500` or `100`) without truncation; the raw
token remains unchanged in the stored QSO and ADIF exchange string. It includes a
transmitter identifier whenever the chosen category requires it. Category operator, assisted, band,
power, transmitter, station, and overlay values must come from an edition-
specific profile. Export fixtures must separately prove a continental-US
station sending `CA` with an `EB` header, a Canadian station whose RAC section
differs from its provincial exchange, KL7/`AK`, KH6/`PAC`, KP4/`PR`, KP2/`VI`,
CY9/`DX`, CY0/`DX`, and an ordinary foreign station/`DX`.

The inactive `arrl-dx-cw-preview-1` and `arrl-dx-ssb-preview-1` formatter slice
supports only the shared `SINGLE-OP`/`ONE` category projection. It therefore
emits no QSO transmitter identifier. The pinned WWROF header authority describes
`CATEGORY-STATION` and its allowed values but, unlike `LOCATION` and multioperator
`CATEGORY-TRANSMITTER`, does not mark it required. The slice omits that header
because the current frozen export input has no station-category declaration; it
must not invent `FIXED`. Full station-category selection and every multioperator
category remain later full-port gates, so this omission does not establish
sponsor submission readiness. A dedicated ARRL DX QSO projection is necessary
only to render the already validated bounded raw power abbreviation, or its
canonical numeric value when the raw token exceeds the six-character template;
validation, scoring, category projection, ordering, and header rendering continue
to use the shared export pipeline.

ADIF retains `RST_SENT`, `RST_RCVD`, `STX_STRING`, and `SRX_STRING`. State fields
are present only on a W/VE side, using the established ARRL mapping for `LB` and
`NF`; immutable `MY_DXCC`/`DXCC` snapshots preserve both endpoints. Do not infer
`TX_PWR` from an on-air exchange or category declaration. A future explicit
station-power telemetry field may map separately.

## Supported preview boundary

The first enabled preview may support single-operator, all-band, practice-mode
plain logging, scoring, corrections, restart, Run/S&P UI, and deterministic
Cabrillo/ADIF goldens. It must say **official-rules ARRL DX practice preview** and
must disclose that it does not establish live event-date eligibility, RF/CW or
voice transmission, physical mobile endpoint, power/antenna/assistance
compliance, multioperator band-change compliance, sponsor upload acceptance,
packaged-app behavior, or cross-platform acceptance.

Full-port scope remains open. Single-band, Single Operator Unlimited,
Multi-Single, Multi-Two, Multi-Multi, checklog, QRP/Low/High, Limited Antennas,
all-log submission for single-band entries, assistance rules, simultaneous
signal limits, ten/six band-change accounting, transmitter IDs, and category
reclassification evidence need explicit dispositions. Operator declarations are
attestations unless station/runtime evidence can verify them.

## Phased implementation and acceptance

1. **Authority and metadata.** Add immutable CW and Phone structured metadata,
   source fixtures for the six current authority documents and two comparator
   files, semantic 48/DC/Canada and 340-DXCC equality checks, exact report/mode/
   band validation, and station-side resolution. Changing any authority bytes
   without review fails the fixture.
2. **Rule engine.** Implement directional exchange validation, power raw/normal
   handling, per-band duplicates and multipliers, checked score arithmetic,
   stable replay, and the independent cases above. Add Alaska, Hawaii, CY9, CY0,
   US possession, portable, invalid-direction, arbitrary-location, tie-order,
   overflow, edit, and delete cases.
3. **Durable worker and UI.** Register both previews explicitly outside the
   frozen pilot registry, validate every worker member, and prove create/open,
   draft, commit, correction, deletion, restart, exact receipt replay, uncertain
   recovery, SCP/history, keyboard flow, and Normal/Contesting switching. Run
   realistic repeated CW and Phone Run/S&P scenarios with external I/O disabled.
4. **Export.** Add CW/Phone Cabrillo and ADIF formatter policies and goldens for
   both entrant directions, duplicates, new-band multipliers, raw power forms,
   `LB`/`NF`, LOCATION, chronological ordering, corrections, and exact hashes.
   Reject crossed rule/mode/profile/category data. Test save cancellation,
   no-clobber publication, and outcome-unknown recovery.
5. **Categories and full source disposition.** Implement or explicitly block
   every ARRL category and operating constraint listed above. Prove single-band
   submitted-versus-scored behavior, assistance declarations, M/S and M/2 band
   changes, simultaneous signals, transmitter IDs, and category headers. Record
   every comparator feature as implemented, corrected, or intentionally
   unsupported; source presence alone is not acceptance.
6. **Integration and runtime.** Update the acceptance ledger only with scoped
   evidence. Run focused native and browser suites, full portable manifests on
   macOS/Windows/Linux, isolated packaged-app operator scenarios, and sponsor
   log-validator/upload checks where available. RF/keying and real voice paths
   require separate hardware evidence. Only then may the family be called
   operational or sponsor-ready.

Until all applicable gates pass, catalog rows and source-derived behavior remain
pending and no acceptance may be inferred from another ARRL rule family.

## Core implementation necessity

The phase 1–2 core uses one additive `ContestRule.validateDraft` capability with
an empty default for every existing rule. ARRL DX needs this narrow hook because
its immutable station exchange has no serial reservation: a W/VE station sends
its frozen location, while a DX station preserves a raw power token such as
`ATT` alongside the normalized value `100`. The existing serial-reservation
freeze cannot express either case without falsely introducing a serial.

The hook returns validation issues only. It does not rewrite a draft, station
snapshot, receipt, or persisted payload. The ARRL DX evaluator repeats the same
frozen sent-field comparison for direct commits, so bypassing draft editing
cannot change the station exchange. Existing rules retain their previous
behavior and wire identities because the default returns no issues and this
phase changes no persisted schema or receipt shape.

The nonpersisted `draftResetSentProjection` rule capability defaults to
`.stationAggregate`, preserving every existing rule's prior reset bytes. ARRL
DX explicitly selects `.soleStationField`; when exactly one station field
remains after any allocated serial field is removed, reset restores aggregate
raw and normalized values from that field's corresponding values. ARRL DX needs
that opt-in for raw power such as `K` with normalized `1000`. Zero-field and
multi-field cases fall back to the established aggregate projection. Initial
drafts and every reset returned by commit, replay, or reopen must expose the
same raw/normalized station-field contract.

## Entry activation necessity

The entry slice adds one nonpersisted `ContestRuleExchangeFieldProjection`
capability. Only ARRL DX adopts it. The runtime passes a newly decoded field
dictionary to the rule, and the rule returns a projected dictionary whose raw
power token is unchanged and whose normalized value uses the already approved
ARRL DX power normalizer. Invalid raw input remains present and is rejected by
the core evaluator; the projection never blanks it or mutates a station
snapshot, QSO, receipt, or stored payload. Existing rules keep their previous
decode and wire bytes because the runtime performs no projection for rules that
do not conform.

ARRL DX reuses the independently validated `cabrilloLocation` station-field
descriptor for Cabrillo `LOCATION`. That field is separate from contest side:
AK, KH6, KP4, and KP2 are scored on the DX side while retaining their ARRL
section values. The station form therefore collects a Cabrillo section plus
exactly one sent exchange, location for a W/VE entrant or power for a DX
entrant. The two sent-exchange controls are mutually exclusive, but both stay
visible because the browser has no authoritative DXCC entity classification
before the worker admits the station snapshot; the worker remains the authority
for direction and rejects crossed or forged fields atomically.

Browser acceptance exercises W/VE and DX entry in both CW and Phone. Power is
uppercased as raw operator evidence while typing; intermediate text such as
`KI` or `KIL` remains editable. The strict client rejects an invalid save
without replacing that local draft or correction, so the operator can repair it
to a valid token such as `KILO` or `100`.

This activation is bounded to the existing SINGLE-OP/ONE export scope and is
labelled as practice in the UI. It does not add simulator profiles, operator
category coverage, RF or voice evidence, sponsor upload evidence, or a claim of
submission readiness. Those remain acceptance gates for the full port.
