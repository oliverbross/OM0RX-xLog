# Not1MM CQ WW host

Python 3.12 standard-library runtime; no user package installation is needed for
the exposed CQ WW callbacks. Run from the repository root:

```sh
PYTHONPATH=python python3.12 -m contest_host --data-root /private/contest-root
PYTHONPATH=python python3.12 -m unittest discover -s python/tests -v
```

The native owner can launch the bundled interpreter with `-I -B` and the absolute
path to `contest_host/launcher.py`, followed by `--data-root` and its private root.
That entry point explicitly adds only its application-relative module directory;
isolated mode ignores ambient `PYTHONPATH` and user site configuration. Package
source files and exclude `__pycache__`/`.pyc` files from vendor resources.

The macOS package stages a private Python 3.12 framework and this host under the
application bundle. This module does not open radios, keyers, rotors, cluster
connections or network services. Its Qt adapter is an explicit finite field boundary,
not a Qt implementation. Unsupported Qt methods fail. ADIF import is unexposed;
its lazy import requires the real `adif_io` package if that callback is added.

## Wire contract

One UTF-8 JSON object per newline: `{id, method, params}`. The loop serializes all
requests. Request maximum 32,768 bytes including newline; reply maximum 1 MiB.
Oversized/incomplete frames terminate the process without attempting resync.
stdout contains protocol only. Replies use `{id,ok,result}` or
`{id,ok:false,error:{code,message,outcome}}`.

Methods (an optional `contest_` prefix is accepted): `catalog`, `sessions`, `session_create`
(`create`), `session_open` (`open`), `projection` (`draft_get`), `draft_apply`,
`focus`, `run_state`, `esm`, `function_key`, `qso_commit`, `qso_correct`,
`qso_delete`, `receipt` (`operation_receipt`), `log` (`log_page`), `score`,
`cw_context`, `rates`, `check_partial`, `setup_get`, `setup_save`, `export`, `export_prepare`,
`export_read`, `export_release`.

Legacy Not1MM migration uses `legacy_preview` before `legacy_import`.
`legacy_preview` accepts a native-selected `sourcePath` plus optional positive
`sourceContestNR`; it opens the SQLite file read-only and returns its durable
source identity, SHA-256 digest, contest/category counts, source settings,
station and exact plugin candidates. `legacy_import` uses the normal creation
envelope plus `sourcePath`, `sourceIdentity`, `sourceDigest` and
`sourceContestNR`. The preview digest and source identity must still match, and
the selected pinned plugin must match the legacy plugin name. Import owns a new
xLog contest session; it never writes to the source database.

Except catalog and sessions, requests contain canonical UUID `sessionID`. All mutations also
contain stable UUID `operationID` and `expectedRevision`. Creation expects zero;
subsequent mutations expect the current revision. Repeat the exact original
mutation after a lost reply. Receipts are checked before revision validation;
reusing an operation ID with different payload fails. Returned actions are
suppressed on replay, including receipt lookup, to prevent retransmission.

Creation additionally supplies `pluginID:"cq_ww_cw"`, `station:{Call,...}`,
`settings:{SentExchange,...}` and `reference:{id,countries:{CALL:country}}`.
Each country contains `entity`, `continent`, integer `cq`/`itu`, `primary_pfx`.
The native host must supply authoritative CTY resolutions; the Python host
contains no production fallback country fixture. The station must resolve.
`operator` optionally overrides the station call.

`draft_apply` accepts partial `fields` using `callsign`, `sent`, `receive`,
`other_1`, `other_2`; optional integer `frequencyHz`; optional `countries` for
new native-resolved calls. Existing country facts are pinned and cannot silently
change. Partial typing is retained; commit requires a call and CQ zone 1–40.
`focus` supplies `field`; `run_state` supplies boolean `run`; `esm` optionally
supplies `field`; `function_key` supplies `key:"F1"` through `F12`.

`qso_commit` optionally supplies UUID `qsoID`, UTC `timestamp` formatted
`YYYY-MM-DD HH:MM:SS`, and draft updates. QSO corrections supply `qsoID`, partial
`fields`, optional `countries` and `reason`; the bounded editor retains original
timestamp/frequency/ID. Delete supplies `qsoID` and optional `reason`. `receipt`
supplies the operation ID. `log` accepts offset and limit 1–100.

Every mutation returns revision, plugin-derived projection, messages and typed
actions. Projection includes field values/visibility/labels/accessibility,
tab maps, focus, Run/S&P, F-key highlights, score and dupe. `score` adds band
country/zone matrices. An output action contains `actionID`, session/draft IDs,
F-key and captured exchange context. Native code must resolve macros and apply
existing explicit operator/transmit controls; no physical action is executed here.

The Main-window projection also carries `operator`, nullable `cwSpeedWpm`
(saved numeric `preferences.cwSpeed` in 1–100 WPM, otherwise null), and
`callContext:{callsign,entity,country,continent,cqZone,ituZone,primaryPrefix,
headingDegrees,longPathHeadingDegrees,distanceKm}`. Country/zone/prefix facts
come only from the current call's pinned CTY record; unresolved facts are null.
Heading, long-path heading and distance are null because the current reference
contract does not provide authoritative coordinates for both endpoints.
`score` includes `multipliers`, the pinned CQ WW plugin's country-plus-zone
multiplier count, alongside its QSO count, points and total score.

`check_partial` accepts a callsign fragment `query` (1–32 ASCII letters, digits
or slash; normalized uppercase), `limit` (1–500, default 100), and optional
`expectedRevision`. It searches every row of the session's contest log using
the pinned `DataBase.fetch_like_calls` substring match and `TS ASC` ordering
(rowid breaks timestamp ties), independently of displayed log pagination.
It returns `{sessionID,revision,query,limit,total,rows}` from one read snapshot;
`total` includes all matching rows even when the reply cap is reached. The
existing `log` and partial-search rows retain the original Not1MM fields:
`TS`, `Call`, `Freq` in kHz, `SNT`, `RCV`, `SentNr`, `ZN`, `WPXPrefix`,
`CountryPrefix`, `Points`, and other stored columns. No Swift rule translation
or second scoring authority is introduced.

`rates` reads all retained `DXLOG` rows in one read snapshot, returning session ID,
revision and `lastHourQsoPerHour`, `last10QsoPerHour`, `last100QsoPerHour`,
`sinceHourUTC`, `sinceHourQso`, `runQso`, `searchAndPounceQso`, `hourRunQso`,
`hourSearchAndPounceQso`. Rates are finite nonnegative numbers or null; hours are
integers from 0 through 23 and counts are
nonnegative integers. The trailing hour and latest samples use count times 3600
divided by newest-minus-oldest seconds. The trailing hour uses `(now-3600,now]`,
reports 1 for one QSO and null for empty/zero-span samples; latest-10/100 require
the complete sample. `sinceHourUTC` and `sinceHourQso` follow Not1MM's
`Since HH:00:00z` display and report the current UTC hour plus the QSO count in
`(UTC hour start,now]`. Hour style counts use the same interval.
Future rows are excluded. Naive Not1MM timestamps are UTC; ISO offsets, Z and
fractional seconds are accepted. A malformed timestamp makes the sampled rate
values null and is excluded from time-scoped counts. Historical `IsRunQSO=1` means Run; other values
mean S&P, independently of today's Run toggle. Corrections preserve `IsRunQSO`
and `Run1Run2`. Reads create no receipts or writes.

`setup_get` returns `{sessionID,revision,setup}`; a legacy session synthesizes its
current name, operator, plugin ID, station and settings plus empty preferences,
network and macros. `setup_save` accepts the normal mutation envelope plus one
complete `setup` object, and returns the normal mutation result plus `setup`.
The object has exactly `name`, `operator`, `pluginID`, `station`, `settings`,
`preferences`, `network`, `macros`. Station/settings values are strings or finite
numbers; network additionally accepts booleans; preferences additionally accepts
booleans and string arrays. Maps contain at most 128 fields, string arrays at
most 64 entries, text values at most 512 UTF-8 bytes. Name/operator/plugin ID
allow 128 bytes; plugin ID must match this host. Up to 24 unique macros contain
exactly mode R/S, key F1–F12, label (128 bytes), template (1024 bytes). The entire
document is bounded to 16 KiB. It is stored in the existing session JSON using
the same atomic revision fence and operation receipts as other mutations.
Saving applies the name, operator, station and settings atomically with the
document. Station calls require an already pinned country resolution; sent CQ
zone must be 1–40 and the plugin/mode remain CQ WW CW. Changing station call
rescores existing rows while retaining their historical operator, station call,
exchange and Run metadata. The active draft's sent zone follows the new setting.
Saved R/S F1–F12 macros replace matching pinned defaults; omitted entries retain
their defaults. Both projections and output intents use these effective macros.
Preferences and network remain durable configuration data only: saving does not
configure external services or enable unsupported preference behavior.

`export` returns actual upstream Cabrillo text with CRLF and a suggested filename,
limited to 512 KiB. The production path uses `export_prepare`, bounded 64-KiB
`export_read` chunks, and `export_release`; xLog verifies the digest and format,
opens its native Save panel, and publishes without overwriting an existing file.
Plugin export staging stays inside the session directory and is removed immediately.

## Storage and current limits

Each session gets `<root>/<sessionID>/contest.sqlite` with upstream tables plus
host metadata/draft, durable operation results, stable identity, audit and deleted
contact records. All QSO changes, score recalculation, draft changes and receipts
commit together under `BEGIN IMMEDIATE`/`synchronous=FULL`. Timestamp/call
collisions reject atomically instead of being silently ignored.

Legacy imports additionally retain an import manifest and one durable receipt
per source row. A retry with the same operation replays its receipt; a retry with
a new operation reconciles the row receipts without semantic QSO deduplication.
Log and partial-search rows expose `legacyProvenance` only for imported contacts,
including the immutable original source row. The edit path keeps a separate
receipt-backed current plugin row so callsign-only or unchanged corrections do
not reconstruct unrelated fields from the five visible editor values.

Only CQ WW CW is exposed. No serial allocator, migration, normal-log transfer,
ADIF import, Not1MM macro editor or full plugin catalog is implemented here.
CW actions are intents: the app resolves an F-key against saved xLog macros and
the shared, explicitly armed output owner. Unknown worked countries can be retained with zero points;
the original plugin's blank-country multiplier query behavior is retained and
must remain visible as unresolved data. The app should reconcile uncertain
output separately: opening/replaying a session never sends an old action.

See `vendor/not1mm/PATCHES.md` for original-source provenance and exact overlays.
