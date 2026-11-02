# macOS 1.4.6 performance update — installed acceptance

## Exact candidate and package

- Canonical `main` source: `a060d5c1952d502995660b912a0219a93fec2683`; functional audit baseline: `83a6e124`.
- User-visible version: **1.4.6**, advanced before packaging. No prior 1.4.6 bundle was reused for another source candidate.
- App executable SHA-256: `520d9a88cfab6ba6dc1ceed7d123c7191511928180e76a781acd875ea89cb075`.
- Worker SHA-256: `2a13fa3df24292a05bfe84b5693a52415fd8bbbde797777c08348131c8eeba77`.
- Developer ID / hardened runtime, team `4WCMQ4U946`, matching the prior installed app. Strict deep signature verification passed.
- Canonical package workflow reran the packaging guards, worker self-test, frontend TypeScript/build/window-bundle checks, Python/CW resource validation and payload privacy scan. The privacy scan passed for 3,538 files with no findings.
- Apple notary submission `05bbcd79-4ea9-4148-be40-7790916037c8`: **Accepted**. Staple/validation passed; Gatekeeper accepted the bundle as `Notarized Developer ID`.
- Initial packaging stopped on an inherited nonexistent SDK path before creating a 1.4.6 bundle. The retry selected the installed Xcode SDK only in the build process; no global developer-directory change was made.

The source and package evidence is retained locally under `.build/performance-fix-20261102/`. Private log snapshots, fixture contents and backup data are excluded from Git.

## Packaged worker timing

Both installed 1.4.5 and packaged 1.4.6 workers were exercised through their ordinary IPC/durable-draft commands against fresh isolated copies of the same consistent 69,581-live-contact snapshot. Process identity, private-root arguments and offline health were verified before requests. Each worker exited normally with code zero. Only the copied workspaces received test contacts.

| Operation | Packaged 1.4.6 observation |
| --- | --- |
| Workspace readiness | 7,302 ms |
| First logbook page | 12.54 ms |
| First map context | 161.05 ms |
| Three durable QSO saves | 10.16–53.56 ms |
| Page after each save, containing the saved contact | 11.92–25.74 ms |
| Page requested alongside map refresh | 15.14–22.65 ms |

These offline worker runs do not start a live cluster. The separate source diagnostic in the main audit reproduced and qualified the full-log cluster rebuild concurrently with interactive database work. The old packaged worker also saved quickly without that live-cluster contention; ordinary disk persistence was not the principal ten-second defect.

The old worker's workspace opening took 24.93 seconds under build load. The two package observations have different host/cache conditions and do not establish a controlled startup speedup. The earlier source comparison was approximately 13 seconds on both revisions. Full integrity validation remains enabled.

## Native app verification

A fresh synthetic fixture contained 5,000 generated contacts, `normal_logging`, a unique native root and WebKit store, and offline network/credential/station isolation. Exact live app and child-worker executable paths, PIDs and complete matching private-root arguments were verified before GUI binding and observations. The matching fixture UUID was visible in the window title before input.

The Operator Desk map and integrated logbook rendered. One `N0PERF` 20 m SSB contact was logged through the native window. The first post-click accessibility observation showed **QSO logged**, a cleared callsign, the new top row, and **5,001** contacts, 1,180 ms after the click began. This includes automation and accessibility observation overhead; it is not instrumented receipt-to-paint latency. Ordinary Quit completed. A read-only WAL-aware comparison verified exactly one new synthetic contact and byte-identical record/deletion payloads for all preceding 5,000 contacts.

An earlier fixture was stopped before any GUI launch because its verification helper opened the SQLite database with `immutable=1` and omitted retained WAL contents. Its evidence was preserved; the corrected helper used `mode=ro` and a separately seeded fixture. No production fallback or production test write occurred.

## Installation and normal workspace

The normal app was already stopped before backup/replacement. The protected backup includes the database, workspace metadata/settings, native state, integration services, preferences and WebKit journals. Installation retained the complete prior 1.4.5 application at `/Applications/OM0RX-xLog-previous-20261102T032522Z-71893.app`. Installer signature/resource/hash checks passed, and the production database was byte-identical before the first 1.4.6 launch.

The installed app and worker hashes matched the qualified package. A deliberate ordinary production launch was process-verified before binding. The first hydrated observation, approximately 25 seconds after process launch, showed the existing draft, **69,581 contacts**, a connected cluster, live spots and the map. The sparse observations do not determine exact first-paint time or exclude every transient banner during startup.

After readiness, full Logbook navigation showed the first page and contact total in the first observation after 2,020 ms. World Map navigation showed the map and 20 mapped spots in the first observation after 1,119 ms. Both measurements include automation overhead. The app was returned to Operator Desk without entering a production QSO or issuing tune/transmit/rotor UI commands. Existing configured automatic services resumed normally.

Read-only preservation immediately after startup verified:

- All **69,582** original records, including deletion state, unchanged; **69,581** live contacts.
- No benchmark contact added to production.
- Integration-settings payload unchanged; existing draft QSO fields, automatic-start provenance and all 32 original main-draft journals preserved.
- All 258 retained forwarded-spot payloads preserved.
- Workspace settings files unchanged. The two changed reference-cache JSON files differed only in scheduled refresh/check timestamps; catalogue content was unchanged. This was checked against the owning automatic-reference-refresh implementation before accepting the comparison.

A later check correctly detected 10 contact payload updates after the existing automatic Wavelog sync completed. Its native durable receipt recorded all 69,581 remote contacts processed, exactly 10 local updates, zero insertions/deletions/conflicts/failures/holds and **zero upload attempts**. Read-only field comparisons found QRZ download date/status metadata, one country/LoTW confirmation-date update and `updatedAt`; all local/remote IDs and deletion states were preserved. Final membership remained 69,582 total / 69,581 live, with 69,572 original payloads still byte-identical. Draft, settings, journals and retained-spot checks stayed unchanged. The failed strict byte-equality report and the subsequent sync-attributed qualification are both retained; no rollback or repair writes were issued to erase valid incoming metadata.

## Remaining limits

This is a local installed performance qualification, not a public/all-platform release or a hardware/provider soak. Startup still includes several seconds of full database validation and network-dependent initialization. Projection recomputation still takes seconds, but no longer holds the interactive database connection. The synthetic GUI test and isolated large-log worker benchmark support the save/refresh change; a production QSO was deliberately not inserted to manufacture an end-to-end live-station timing claim. Real cluster transport/provider failures remain visible.
