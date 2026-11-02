# macOS 1.4.8 startup optimization — installed acceptance

## Exact source and installation

The local Apple Silicon application is updated to **1.4.8**.

- Functional commit: `8526091754e8d0008d67fcf0b59ef39df7207e51`.
- Exact version/package source: `2ae0939d1a69fb8c8210a24880b04929b8d46d7c`, built from canonical `main` after recording the version and manifest hashes. Both commits were pushed before packaging.
- App executable SHA-256: `84ce8762749999ff732ae797491f7e8b19d55cc581f4442d702664a6ee5c6f0a`.
- Worker SHA-256: `0d744e7987250f8ed03563a4ea3f1017e25c551a15a520f138addca464ed73c9`.
- Stable Developer ID / hardened runtime, team `4WCMQ4U946`; strict deep verification passed, matching the previous installed identity.
- Apple notary submission `660f2379-3190-41a2-b1e2-712930ef5d8c`: **Accepted**. Stapling, ticket validation and Gatekeeper `Notarized Developer ID` assessment passed.
- Final archive SHA-256: `c4b5aa6a7454edaac072d5d86dda5fa3454f1af66d102f687eb01fc877cbaa83`.

Canonical packaging reran worker self-tests, frontend TypeScript/build/window
bundle gates, native staging/resource checks and the payload privacy scan. The
privacy scan passed for 3,538 files. No frontend source changed; the existing
dashboard callsign context menu, confirmation and Undo behavior remain included.

The app was already stopped before the fresh protected backup. Installation
verified the production database byte-for-byte before and after replacement,
before the first updated launch. The complete previous 1.4.7 application remains
at `/Applications/OM0RX-xLog-previous-20261102T082433Z-16596.app`.

Protected backup:
`/Users/oliver/Documents/Backups/OM0RX-xLog/startup-before-1.4.8-20261102T172552+0930`.
Private detailed receipts are under `.build/startup-fast-20261102/`; private
snapshots, journals, call data and generated fixtures are not committed or shipped.

## Controlled bundled-worker measurements

Both versions ran through their ordinary IPC against independent, consistent
copies of the same 69,582-stored / 69,581-live-contact snapshot. Exact executable,
PID and private-root arguments were verified before requests. Offline health
confirmed isolation, with external network/credentials/station I/O disabled.
Every measured worker exited normally with code zero. Heavy builds were finished
before the controlled startup runs.

| Operation | Observation |
| --- | --- |
| Original 1.4.7 workspace open, three samples | 4,655 / 5,463 / 5,803 ms |
| Original 1.4.7 repeated after the candidate | 4,294 / 4,171 / 3,593 ms |
| 1.4.8 first upgrade, including one-time migration | 9,116 ms |
| 1.4.8 ordinary subsequent workspace opens | 1,070 / 1,121 ms |
| 1.4.8 complete settings/draft/preferences hydration from process start | 1,210 / 1,245 ms |
| 1.4.8 first logbook page | 7–9 ms |
| 1.4.8 first map context | 99–112 ms |
| Three durable saves on a separate private large-log copy | 3.65–6.98 ms |
| Page after each save, verified to contain the new contact | 7.39–8.00 ms |
| Page alongside concurrent map refresh | 7.57–11.22 ms |

The approximately one-second result measures authoritative workspace readiness,
not complete native application first paint or a remote cluster handshake. Keep
the one-time migration separate from ordinary startup; production was migrated
by the application, without a separate pre-migration command.

## Regression and migration verification

- All 348 native core tests across 47 suites passed.
- Live logbook/cluster/contact-publication qualification passed: 55 tests across four suites. The optional large-log cases were then explicitly enabled separately.
- Generated 100,000-contact qualification passed: first page 3 ms, statistics 144 ms, progress 272 ms, map aggregate 163 ms, catalogue 518 ms, history 395 ms, projection rebuild 3,714 ms. Contact reads p95 0.128 ms and edits p95 1.068 ms. This is a generated core fixture, not an installed GUI timing.
- Generated 68,000-contact durable-owner qualification passed all 50 saves while background classification publication was held: median 2.922 ms, p95 6.800 ms, maximum 40.427 ms. Independent connections verified durable receipts and committed row counts.

On the consistent real-log private copy, all authoritative QSO columns remained
byte-identical and the QSO revision was unchanged after migration. Every compact
projection row matched its source values **and SQLite value types**, across all
69,582 stored contacts. Source JSON remains authoritative. Full integrity and
all-contact JSON validation stay enabled; no integrity-result cache or reduced
validation replaced them.

Rollback compatibility was exercised with the actual installed 1.4.7 worker
before replacement: it reopened a migrated copy, recreated its legacy indexes
and durably saved three disposable contacts. All 69,585 resulting stored rows
matched their projection values/types. The 1.4.8 worker then reopened that copy
three times, retaining all 69,584 live contacts. Full authoritative-column byte
comparison and revision comparison remained unchanged across that round trip.

Two initial optional reference-comparison runs could not read a newly exported
standalone WAL snapshot with missing sidecars. Diagnostics identified the private
reference file, not the application's reopened copy. The corrected verifier uses
the existing workspace bootstrap's query-only read/write opening method solely
to materialize sidecars for its private reference, then performs the ordinary
read-only comparison. The entire reference database file stayed byte-identical.
The final strict comparison passed. Failed evidence is retained; no immutable
read, production repair or weakened application guard was used.

## Native window and normal workspace

A marked, private native fixture contained **70,000 synthetic contacts** and a
nonempty operator draft. The owning `normal_logging` enum, exact app and child
worker PIDs/executables/full matching private-root arguments, and offline health
were checked before GUI binding. The window's unique offline UUID matched before
input. Dashboard, map and the first logbook page/70,000-contact total rendered.
Ordinary Quit completed; read-only verification found all original contact
payloads/deletion states and the entire operator draft unchanged. No synthetic
contact was written to production.

The installed application and worker hashes matched the qualified package.
Deliberate normal launches were process-verified before exact application-path
binding. The first upgraded session displayed the existing draft, 69,581 live
contacts, connected radio/cluster, live spots and the map. Its sparse observations
do not measure exact first-paint timing.

After ordinary Quit and process-only stopped verification, a separate deliberate
normal relaunch showed the dashboard, preserved draft, logbook and map in the
first observation, 11.84 seconds after launch including tool/AX overhead. Cluster
connections were still establishing then; the desk was usable independently.
Later observations showed one connected cluster, 36 live spots and 31 mapped
spots, with no startup error banner. Two other configured providers remained
connecting; their provider/network readiness is not represented as completed.

Full Logbook navigation showed the first 40 rows and total in the first
observation after 1,474 ms; World Map showed the map/31 mapped spots after
1,099 ms. These include automation and AX overhead. The application was returned
to Operator Desk with the original draft. No production QSO, delete, tune,
transmit or rotor test input was issued.

## Production preservation

After install, first startup and the ordinary relaunch, checks verified:

- All 69,582 original contact payloads and deletion states retained unchanged; 69,581 live contacts.
- Original draft QSO fields and automatic-start provenance unchanged.
- Integration-settings payload unchanged; all 34 original main-draft journals retained without changed QSO fields.
- All 258 original retained forwarded-spot payloads preserved.
- Workspace settings files unchanged; no benchmark contact added.

A final read-only comparison also verified every authoritative QSO column,
including baselines and scalar sync fields, byte-for-byte against the fresh
backup. QSO and per-contact revisions were unchanged; pending/outbox counts
remained zero. The new projection contains all 69,582 stored rows, and the three
legacy JSON expression indexes are absent.

The unchanged automatic reference updater downloaded the next POTA catalogue:
103,377 → 103,380 entries, 10,303,139 bytes, same source identity, newer provider
Last-Modified/ETag. Its native owning code validates the downloaded catalogue
before atomic replacement and records counts, bytes, validators and status.
Independent CSV reference/name counting matched those values. Qualification pins
the exact refreshed CSV hash and validators; every other reference file remained
byte-identical, apart from the separately checked Wavelog catalogue timestamp.

The original strict reports correctly failed on those five POTA metadata-field
differences and are retained. Separate qualified reports confirm all authoritative
preservation checks and accept only the verified, pinned catalogue refresh. No
broad future-cache exception or rollback of legitimate refreshed data was used.

## Qualification boundary

This is the installed local macOS startup fix. Native rendering/navigation,
large-log worker performance, migration, legacy-worker compatibility and data
preservation are qualified. Cluster handshakes and remote service availability
remain network/provider dependent. The native GUI checks did not insert a
production QSO to claim an exact live-station save-to-paint measurement. This does
not extend the earlier unrelated hardware, CW/RF, provider soak or public
all-platform release acceptance.
