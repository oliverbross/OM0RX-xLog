# Call-History Import and Assistance Contract

Status: proposed, audited contract for F18. No product code, worker route, catalog activation, UI activation, export, package, or radio behavior is authorized by this document.

## Authority and scope

The behavioral comparison is the clean, read-only `contest-sw` checkout at commit `7c8b499225a73f7f8f792246881bd7aefc05452f`. This pin, rather than a recollection of N1MM or another logger's format, defines the upstream behavior described below.

| Evidence | SHA-256 | Relevance |
| --- | --- | --- |
| `not1mm/__main__.py` | `9ae7aca936484ed6de390746355c0f7cb0a0906b0d373c411a6236cf85d49d4e` | File selection, destructive replacement order, UTF-8 decoding, marker/header parsing, and row parsing |
| `not1mm/lib/database.py` | `855840a01e80e82fc5d7e83c1e7e9f0f367e6db9be504944e0db0173e28e52e8` | Table columns, insert behavior, lookup, and duplicate handling |
| `call_history_keys.md` | `d22fd116e8e4c47f1e320eb3284264bbab3b2d7e48777c6f368b3802c95b8a95` | Upstream's documented key families |
| 60 plugin files containing executable call-history calls | manifest digest `55d6bbb72243478b055ffa572de18f9b463eb813a2fa79b753eee6d54dbe3ef9` | Actual display and prefill key use; the manifest is the SHA-256 of path-ordered lines in the form `<file-sha256>  <plugin-path>` |

The active-plugin audit was run with `/opt/homebrew/bin/python3.14`; its exact audit script has SHA-256 `cb48ed2db88b61eae499866337d75eb037464faf715e0272f150c71d5dfa94c5`. Python 3.9 cannot parse every pinned plugin and is not an equivalent reproducer. The algorithm enumerates sorted `not1mm/plugins/*.py`, parses each with `ast.parse`, examines module-body `ast.FunctionDef` nodes named `populate_history_info_line`, `check_call_history`, or `prefill`, and retains a function only when `ast.walk` finds an executable `ast.Call` whose attribute name is `fetch_call_history`. It collects literal result keys only from executable `result.get(<string constant>, ...)` calls and `result[<string constant>]` subscripts. At this pin, no retained function is named `prefill`: the result is 60 `populate_history_info_line` plus 59 `check_call_history` functions across 60 files. Hash every selected file and, in ascending repository-relative path order, emit each line exactly as `<lowercase SHA-256><two spaces><repository-relative path>\n`; hashing those manifest bytes reproduces `55d6bbb72243478b055ffa572de18f9b463eb813a2fa79b753eee6d54dbe3ef9`. The complete indexed-result key union remains `CK`, `CQZone`, `Call`, `County`, `Exch1`, `Exchange1`, `Loc1`, `Name`, `Power`, `Sect`, `State`, and `UserText`.

A raw-text search overcounts five functions because comments are not executable AST nodes: both functions in `cqws.py` are marked `Not Used` and contain only commented history code; both in `dxpedition.py` are marked `disabled` and contain only commented history code; and `wia_remembrance.py` has an active display function but its `check_call_history` body contains only commented lookup/prefill code. CQWS and DXpedition therefore have no active history behavior at the pin, while WIA Remembrance is display-only. These cases are explicit negative inventory evidence and must not acquire prefill from commented examples.

The upstream database creates these 15 columns, in order: `Call`, `Name`, `Loc1`, `Loc2`, `Sect`, `State`, `CK`, `BirthDate`, `Exch1`, `Misc`, `Power`, `CqZone`, `ITUZone`, `UserText`, and `LastUpdateNote`. SQL identifier lookup is case-insensitive, but the upstream `row_factory` returns an ordinary Python dictionary keyed by `cursor.description` spelling. Consequently, `SELECT *` yields `CqZone`, while CQ WW plugins ask the case-sensitive dictionary for `CQZone` and receive an empty fallback. `CqZone`/`CQZone` is therefore an upstream defect, not compatible behavior to copy. xLog deliberately canonicalizes ASCII header case for lookup while retaining original spelling. `Exch1` and `Exchange1` remain semantically distinct. Active plugin code also reads `Exchange1` and `County`, although neither exists in the upstream table. Those mismatches must remain visible in previews and evidence rather than being silently repaired or omitted.

The case defect was reproduced from the pinned `row_factory` and schema with this standalone fixture (fixture SHA-256 `623833b7afaeb74f59e661006b880c15dda6eabb19d3007ae810ea0d80027e38`; output SHA-256 `58a85dd63373c40cc9fe773e887d924f597060f7cf0dc90b6ae5ca17028cb4eb`):

```python
import sqlite3


def row_factory(cursor, row):
    return {column[0]: row[index] for index, column in enumerate(cursor.description)}


connection = sqlite3.connect(":memory:")
connection.row_factory = row_factory
connection.execute("CREATE TABLE CALLHISTORY (Call TEXT NOT NULL, CqZone INTEGER)")
connection.execute("INSERT INTO CALLHISTORY VALUES ('K1ABC', 5)")
result = connection.execute("SELECT * FROM CALLHISTORY WHERE Call = 'K1ABC'").fetchone()
print(result)
print(repr(result.get("CQZone", "")))
```

The exact output is `{'Call': 'K1ABC', 'CqZone': 5}` followed by `''`. The authoritative implementation source remains `not1mm/lib/database.py` at the hash above; this fixture isolates its observable dictionary behavior.

Relevant plugin source hashes for rules currently implemented or reviewed in xLog are:

| Plugin | SHA-256 | History behavior at the pin |
| --- | --- | --- |
| `cq_ww_cw.py` | `08f383e8ddb6f02fede9149f5490a1042b71a5cd5e2591ac76b0cf1ba460c3e2` | Displays `Call,CQZone,UserText`; proposes `CQZone` |
| `cq_ww_ssb.py` | `9ec3762986761232042389f0334b4887271772d18025f3dd0fdc820782105b3b` | Displays `Call,CQZone,UserText`; proposes `CQZone` |
| `naqp_cw.py` | `84da97206ac651638498812dc7867432c883e88650a86571161ca5e3a72b222b` | Displays `Call,Name,State,UserText`; proposes `Name,State` |
| `naqp_ssb.py` | `551b57f984cbaf4697a3ae9b146ad6f3519a14cc8df0dc9c3f30a7c5fea7c2bc` | Displays `Call,Name,State,UserText`; proposes `Name,State` |
| `naqp_rtty.py` | `f74bc7f40d257e0f3db7270c8e7b4bec00d6c50c11af37baa8aaa8a7f3f131c1` | Displays `Call,Name,State,UserText`; proposes `Name,State` |
| `arrl_rtty_ru.py` | `51ec034028d5afa0d2788acb4e718d9699a198b2392dde2dbe78a0abfad31df6` | Displays `Call,Name,State,UserText`; proposes `State` |
| `arrl_dx_cw.py` | `50dad8d13b4e782f6a846660f96a96357ae96866dac4ae5787f97818ed00e2d2` | Displays `Call,Name,Power,State,UserText`; proposes role-dependent `Power` or `State` |
| `arrl_dx_ssb.py` | `357f333526a8cda2f654c84245056cf47cc95bbb0be0c1add64b1e53c3474387` | Displays `Call,Name,Power,State,UserText`; proposes role-dependent `Power` or `State` |
| `jidx_cw.py` | `457e6ba45da31a90c06fc9508dee8d1dccf053b0676083c2472082dd61c18e53` | No active history display or prefill function |
| `jidx_ph.py` | `20b3e8d7154d51c264817a5755d753c2be4bce9896a64d10cb63478837e06860` | No active history display or prefill function |

The pinned CQ WPX, Oceania DX, and SAC plugins also have no active call-history functions. Absence is meaningful: this contract does not invent prefill for them or JIDX.

## Observed upstream behavior and intentional deviations

The operator chooses a file. Upstream immediately creates the table and deletes the previous dataset, then opens the selected file as UTF-8 with decoding errors ignored. It reads the whole file, finds the first line containing `!!Order!!` that does not contain `#`, splits that line and later rows on literal commas, skips later lines only when `#` is the first character, fills missing cells with empty strings, drops excess cells, and skips empty header tokens without consuming a cell. Duplicate header names overwrite earlier values in a row dictionary. It inserts every parsed row without a primary key and queries `where call = ?` using `fetchone`, so duplicate calls persist while the winning row is unspecified. Parse and insert failures are logged but are not surfaced as a transactional preview. There is no upstream call-history generator or export path.

xLog must preserve compatible useful data while intentionally rejecting lossy or ambiguous cases:

- Input is strict UTF-8, with an optional UTF-8 BOM, and may use LF or CRLF. Invalid UTF-8 is a preview error; bytes are never ignored or replaced.
- The format is literal comma-delimited text. Quoting and embedded-comma CSV semantics are unsupported because the pinned parser does not implement them. A quote has no special meaning.
- The first line containing no `#` whose first comma-delimited token is exactly `!!Order!!` is the header marker; preceding preamble is ignored. One trailing empty token caused by a terminal comma is allowed. Interior empty headers and duplicate headers after ASCII case folding are errors.
- Exactly one header must canonicalize to `call`. It is required even when every row is unindexable. Header identity is the original 1-to-64-byte UTF-8 spelling plus a separate canonical form produced by lowercasing ASCII `A` through `Z` only. A header may contain non-ASCII text, but it must contain no comma, ASCII control, or leading/trailing whitespace. Unknown headers satisfying these bounds are preserved. Case canonicalization applies to every header name to prevent ambiguous duplicates; it does not create semantic aliases. Thus `CqZone` and `CQZone` collide as the same canonical header, while `Exch1` and `Exchange1` do not.
- A data row with fewer values than headers receives empty trailing values. A row with extra values is an error instead of silently dropping evidence.
- Only `#` in column one marks a comment. Blank lines are ignored. Leading whitespace before `#` does not create a comment.
- Import retains the exact source bytes, their SHA-256, the display-safe source filename, and acquisition time as provenance. It also retains each original header spelling and order and each decoded value. Canonical key identity is stored separately for lookup.
- The raw `Call` value is first rejected for indexing if any original UTF-8 byte is non-ASCII. Only after that guard does indexing trim leading/trailing whitespace and newlines, uppercase the ASCII value, and accept it when the result is 2 through 32 UTF-8 bytes composed of `A-Z`, `0-9`, or `/`. This order exactly reuses the current SCP normalizer and minimum-length gate: non-ASCII whitespace surrounding an otherwise valid call remains invalid and is not trimmed into acceptance. Query uses the same normalization. Active contest rules may impose stricter callsign validity when a proposal is applied; call-history indexing does not replace rule validation.
- A row with a blank or invalid `Call` value is retained losslessly with its source ordinal but marked unindexable. The preview reports its line and reason, excludes it from duplicate-call counts and query results, and requires explicit confirmation before commit. It is never silently dropped or repaired. A dataset with no indexable rows is a blocking preview error.
- `CqZone` and `CQZone` canonicalize to the same lookup key as an explicit xLog correction for the upstream schema/plugin defect. Their original spelling is retained. No semantic aliases are inferred, especially not `Exch1`/`Exchange1`.
- Every syntactically valid unknown header and its values are retained. Known-but-not-persistable upstream keys such as `Exchange1` and `County` are retained under their original names and reported as unmapped unless a future rule contract explicitly consumes them.

These are deliberate xLog safety and preservation rules. The limits for the first implementation are 16 MiB per source file, 100,000 data records, 128 headers, 64 UTF-8 bytes per header, 4,096 UTF-8 bytes per value, and 16 KiB per physical line. The 16 MiB and 100,000-record limits reuse the current SCP service bounds; the other limits are proposed xLog admission bounds, not upstream claims. A preview exceeding any limit fails without changing the active dataset.

## Dataset, duplicates, and persistence

Call history is a persistent reference dataset. It is not a contest session, QSO log, SCP dataset, or `LocalContactHistory` projection. The service must use an independent typed model and storage envelope while reusing the existing immutable-dataset, digest, generation, bounded-read, and atomic-replacement patterns.

Each imported row receives its source ordinal and a stable record identity derived from the dataset digest and ordinal. Duplicate normalized callsigns are retained in source order, included in the preview duplicate count, and returned together by exact normalized-call lookup. Neither import nor lookup chooses a first or last duplicate. The operator must explicitly select a returned record, including when lookup returns exactly one record; query alone has no mutation effect.

Import has two separate steps:

1. A native private-file picker reads a bounded file and creates a read-only preview. The renderer receives no path. The preview reports source digest and encoding, original and canonical header order, known, unknown, and unmapped keys, row and duplicate counts, limits, and every blocking or advisory issue.
2. Commit carries an unexpired preview token, source digest, preview dataset generation, and explicit operator confirmation. The service reparses or verifies the captured bytes and publishes one complete immutable generation atomically. Cancellation, expiry, changed bytes, stale generation, parsing failure, storage failure, or corrupt cache leaves the prior dataset active.

Restart must reopen the exact committed generation, validate its envelope and digest, and preserve source order, unknown fields, duplicate rows, and original header spellings. A corrupt persisted candidate must not partially publish. Replacement invalidates outstanding queries and selections from every prior dataset generation.

## Lookup, selection, and stale-work rejection

The existing SCP architecture is the reusable boundary, without conflating SCP data with call history:

- `ContestCallsignAssistance.swift` (`d188378f8ab9cb64df6fa893a8f98fa3940a3b3effb4462f755b158e891fcce6`) supplies immutable dataset provenance, bounded lookup, and explicit match-selection validation.
- `ContestAssistanceLane.swift` (`ace26413966961135b7fac2ff773e57e1a5e1b768f5e07e6b2f78d9bfc93497c`) supplies request caps, cancellation, replacement, and stale-response fencing.
- `ContestSCPService.swift` (`01ffee9bd296de9ab04b542383f9932e271343cfa7dbba92e9fd9deb3e842ea4`) supplies private bounded file reads, atomic persisted envelopes, immutable replacement, and retention of the previous valid generation after a failed replacement.
- `ContestWorkspace.tsx` (`73b9cf1afca8dd12b8cf3b1e932a62c553d0e686570a4e2eab82df685a00aede`) supplies owner/admission checks and exact session, workspace-generation, draft, and unchanged-input fencing before applying an SCP selection.
- `ContestAssistancePanel.tsx` (`e1977540b566e4a85c1813679824c021e04813852591b41268ac6a3aeeec0872`) and `contestAssistance.ts` (`d746b3f15cd672888dc4b81043aad92b089a46766d444074cf5b9bf53b7f83b4`) supply the existing shared assistance presentation and typed client boundary. Call-history status and selection should extend that surface rather than create a second contest-assistance UI.
- `LocalContactHistory.swift` (`e4fdb9065573bf1d057fda7cac4cdb27f24d6c4ed590417dadece6b55460cde5`) projects the operator's own QSOs. It is evidence that local history already has a distinct purpose and must not become storage for imported reference rows.

A call-history query and selection must bind dataset generation and digest, session ID, workspace generation, session revision, draft ID, draft revision, normalized input callsign, request ID, rule identity and version, and the selected record identity. The backend must confirm that the live session, rule, draft, callsign, dataset, and record membership still match. The client must then recheck the active owner lease, admission, and identical scope before showing or applying the result. A changed callsign, exchange, rule, session revision, draft revision, workspace generation, dataset generation, or request supersession makes the proposal stale.

Lookup is read-only. Selection produces a typed proposal containing the selected record and a list of eligible field projections; it does not edit a draft. Applying one or more projections uses the ordinary authoritative draft mutation path and returns the worker-accepted draft. There is no automatic selection, timer-driven write, implicit first-match use, or background prefill.

## Rule-specific field projections

History may propose only an approved received-exchange target. For v2 entries, the target must be a field declared by the active structured descriptor. The approved legacy v1 CQ WW path may target its existing `received == cqZone` exchange without forcing a descriptor or wire-version conversion. No other undeclared or legacy target is allowed. History must never replace the callsign, sent exchange, station metadata, operator identity, or a nonempty operator-entered received field. Raw and normalized proposed values must pass the applicable legacy zone bounds or v2 descriptor byte bounds and accepted kinds, followed by the active rule's authoritative `validateDraft`. `UserText`, unknown keys, and recognized keys with no active mapping are display-only.

| Rule family | Eligible projection after explicit selection | Required guard |
| --- | --- | --- |
| CQ WW CW/SSB | `CQZone` to the received zone field | Target is blank; typed zone and rule validation pass |
| NAQP CW/SSB/RTTY | `Name` to received name and `State` to received location, independently | Each target is blank; selecting one record does not overwrite either nonempty field |
| ARRL RTTY Roundup | `State` to received location | Only when the live rule/session expects a W/VE subdivision; never into a DX serial field |
| ARRL DX CW/SSB, while inactive | `State` when a DX entrant works W/VE; `Power` when a W/VE entrant works DX | The active rule's typed station/worked role selects exactly one mapping; never reproduce the upstream ambiguity where one assignment can overwrite the other |
| CQ WPX, Oceania DX, SAC, JIDX | None | Do not activate lookup, selection, or prefill for these rules because the pinned plugins have no history functions |

This table is exhaustive for the currently implemented or reviewed contest families. There is no generic key-to-exchange-field fallback. Adding a mapping requires pinned upstream code evidence, a descriptor-compatible field, an explicit rule contract, and independent tests.

## QSO and export boundaries

The selected history row remains reference data. Once the operator explicitly applies a proposal and commits the draft, the QSO stores the actual rule-validated raw and normalized exchange fields through the normal store and audit path. Later history replacement must never rewrite a draft, QSO, receipt, score, Cabrillo, or ADIF record.

Unknown history fields and unselected values do not enter `QSO.extraFields`; that structure remains the ADIF preservation mechanism in `Models.swift` (`0f2073c05db17482264446cb8346510f4b39aaf9e0edad9373f92676969598eb`) and `QSOADIF.swift` (`1c95a50e06e42cb02a54321e361f5995150db58eeefb30c2c7ece2481957bc59`). Existing ADIF evidence is relevant only as a pattern: `ADIF.swift` (`d05475ce68cff96140fa4528ed475dc58030d39fcd5b69a8d0f77b32f9b2cecd`) separates strict preview and explicit import planning, while `LiveLogbookMethods.swift` (`eaef1163fdef6bdf52da66034b0d3aca97b627bfa380ea821147560845a8578c`) fences preview token, generation, sequence, expiry, and confirmed updates. `ADIFTransferTests.swift` (`2d7ee9e8d5b20a4400abe51b15a07cc35d2bea2077e2c5376d7e4af7072b16f7`) proves unrelated unknown ADIF-field preservation; it does not authorize copying history fields into a QSO.

The pinned upstream has no call-history export or generator. The first implementation therefore has none. If separately approved later, generation/export must be a distinct immutable prepare/read/release operation that snapshots the dataset generation and digest, preserves header spelling and order, unknown fields, duplicate rows, and source ordinals, and states whether it emits canonical text or the retained original bytes. Canonical generation must never be described as byte-for-byte round-trip output.

## Independent fixtures and acceptance tests

Fixtures must be hand-authored and expected results computed without calling the parser, mapper, rule, or exporter under test as the oracle. At minimum they cover:

- UTF-8 non-ASCII values, BOM, LF, CRLF, final line without newline, invalid UTF-8, the exact marker requirement, and literal quote behavior;
- missing, repeated, differently cased, empty, control-bearing, whitespace-padded, overlong, and non-ASCII unknown headers, proving the required unique `Call` header, ASCII-only canonicalization, preservation of valid unknown spellings, and absence of semantic aliasing;
- every 15-column upstream schema key and every 12-key active-plugin union member, including the `CqZone`/`CQZone` lookup equivalence and distinct `Exch1`/`Exchange1` identities;
- `Exchange1`, `County`, and arbitrary unknown headers retained with original spelling, ordering, empty values, and non-ASCII values;
- blank, one-byte, overlong, non-ASCII, non-ASCII-whitespace-wrapped, illegal-character, and valid mixed-case `Call` values, proving the pre-trim ASCII guard, that invalid rows remain present and reported but unindexable, that duplicate counts cover indexable normalized calls only, and that a dataset with no indexable call is rejected;
- duplicate calls retained in source order, duplicate counts, stable row identities across restart, and explicit selection for one or many matches;
- duplicate normalized headers, interior empty headers, overlong lines/headers/values, too many headers/records, invalid UTF-8, and excess data cells rejected without replacing the active generation;
- short rows padded with empty trailing values, blank lines ignored, column-one comments ignored, and whitespace-prefixed `#` treated as data;
- preview cancellation, expiry, byte/digest change, storage failure, and corrupt persisted candidate retaining the previous valid dataset;
- stale dataset generation/digest, session, workspace generation, session revision, draft, draft revision, input callsign, request, rule, and record membership rejected independently, including tampered and cross-dataset record IDs;
- legacy v1 CQ WW and v2 NAQP, ARRL RTTY, and both ARRL DX entrant roles mapped exactly as above, with raw/normalized validation and an explicit operator choice, while CQ WW remains v1;
- every nonempty operator-entered target left byte-for-byte unchanged, including partial NAQP cases where only one of name/location is blank;
- CQ WPX, Oceania DX, SAC, and JIDX expose no call-history lookup, selection, or prefill activation;
- applying a proposal, committing, editing, deleting, replaying, and reopening use ordinary QSO semantics, while dataset replacement leaves committed QSOs and contest exports unchanged;
- no history fields leak to QSO `extraFields`, Cabrillo, or ADIF, and no export/generation route exists in the first slice.

Compatibility tests must keep the existing SCP tests for duplicate suggestions, exact explicit selection, stale context, dataset membership, and cross-dataset rejection green. Existing local QSO-history and ADIF import behavior must remain byte-for-byte compatible.

## Phased implementation and acceptance gates

The first bounded implementation is core and service infrastructure only:

1. Add a typed lossless row/dataset model, strict parser, preview diagnostics, immutable persisted envelope, atomic replacement, exact-call query, and explicit record-selection validation. Reuse the SCP service and assistance-lane patterns, but use distinct storage, identities, routes, and tests. Do not add draft mutation, worker exposure, UI, catalog activation, or export.
2. After review, add private picker and worker preview/commit/status/query/select routes plus a shared read-only result panel. Prove all stale-generation and owner/admission fences before enabling proposal application.
3. Add typed blank-only projections for CQ WW and NAQP first, then ARRL RTTY. Add ARRL DX mappings only with that rule's activation. Do not activate assistance for any other rule until its own pinned contract and tests exist.
4. Run portable and native core/store/worker/frontend/build checks, followed by native package and operator-flow acceptance when those stages are separately authorized.

F18 remains pending until the applicable phase has runtime evidence. This contract provides no native package, real-radio/keying, operator-run, current external-format compatibility, automatic prefill, call-history generation/export, or sponsor acceptance evidence. Those exclusions must remain visible in acceptance records.
