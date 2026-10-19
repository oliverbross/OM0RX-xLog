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
`cw_context`, `export`, `export_prepare`, `export_read`, `export_release`.

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

Only CQ WW CW is exposed. No serial allocator, migration, normal-log transfer,
ADIF import, Not1MM macro editor or full plugin catalog is implemented here.
CW actions are intents: the app resolves an F-key against saved xLog macros and
the shared, explicitly armed output owner. Unknown worked countries can be retained with zero points;
the original plugin's blank-country multiplier query behavior is retained and
must remain visible as unresolved data. The app should reconcile uncertain
output separately: opening/replaying a session never sends an old action.

See `vendor/not1mm/PATCHES.md` for original-source provenance and exact overlays.
