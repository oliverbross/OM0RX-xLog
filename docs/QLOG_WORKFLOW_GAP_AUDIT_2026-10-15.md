# QLog workflow comparison — 15 October 2026

This is a read-only source and workflow comparison, not a parity claim. xLog
will implement selected ideas in its own architecture and code. No QLog code,
artwork, settings, credentials or logbook data was copied, and QLog was not
launched.

## Evidence and limits

- Upstream reviewed: [`foldynl/QLog`](https://github.com/foldynl/QLog) at exact
  commit [`cbb75f2f2555a4a84c9761e38075754f4821c27c`](https://github.com/foldynl/QLog/commit/cbb75f2f2555a4a84c9761e38075754f4821c27c), shallow-cloned into a temporary
  directory outside the xLog repository.
- The review covered the README, current changelog, UI inventory and the alert
  evaluator, rule editor, alert table and network-notification source. It did
  not execute QLog, open a database, read a saved preference or connect a
  radio, rotator, cluster, callbook or online-log account.
- QLog is a useful operator-workflow reference because it combines a local
  SQLite logbook with DX Cluster, WSJT-X, band maps, Hamlib, rotator/CW support,
  maps, awards, callbooks and several online log services. Those feature names
  are inventory evidence, not proof that their current runtime behavior was
  accepted on this Mac.

## Alert design evidence

QLog's current alert implementation has several mature interaction patterns:

- named rules can be added, enabled, disabled, edited, cloned and removed;
- each rule can combine source, DX callsign expression, country/entity,
  log-status novelty, continent, spot comment, band, mode, spotter geography,
  membership, CQ/ITU zone and POTA/SOTA/IOTA/WWFF conditions;
- one evaluator applies all enabled rules to each DX Cluster or WSJT-X CQ spot
  and emits the complete set of matching rule names;
- the alert table exposes rule, callsign, frequency, mode, update count, last
  update, comment and membership, with sorting, movable/visible columns,
  selected/all clearing and age-based expiry;
- repeated reports are merged and counted, a bell is optional, and outbound UDP
  notification is a separate consumer of the evaluated alert.

QLog currently merges table rows by callsign, mode group and a 5 kHz frequency
tolerance. Its main-window alert banner and table double-click can tune or reply
to the represented station. Those behaviors are informative references, not
xLog requirements.

## Adopt, improve and defer

| Decision | xLog direction |
| --- | --- |
| **Adopt** | Named independently enabled rules, structured AND conditions with explicit multi-value OR choices, all matching rule names on one alert, a bounded recent-alert dashboard, repeat counts, clear/expiry controls, customizable columns and a separate delivery-adapter boundary. |
| **Improve** | Evaluate from xLog's single native cluster owner; persist configuration atomically with generation/revision checks; default the entire feature off; identify repeats from the retained source epoch/spot identity and semantic call/band/mode rather than a loose frequency tolerance; impose explicit dedup and delivery rate limits; retain source freshness and classification text. |
| **Keep passive** | Opening, closing, resizing or refreshing Alerts never starts another cluster poller. An alert row may offer a future explicit “Review spot” handoff, but it never tunes, transmits, keys CW or moves a rotor. Existing retained station-safety reporting remains a distinct “not a live all-clear” section. |
| **Defer** | Native popup, bell, speech and outbound UDP are separate default-off adapters after the rule owner and test action are accepted. WSJT-X CQ becomes a possible source only after its receive contract supplies equivalent stable identities; the existing Logged ADIF receiver alone is not a CQ-alert feed. Advanced regular expressions are deferred until bounded evaluation and clear validation can be guaranteed. |

## Broader workflow candidates

The current source inventory also reinforces several already tracked or useful
directions:

| QLog convention | xLog status / decision |
| --- | --- |
| Customizable dense workspace, saved table state and independent band maps | Already a primary xLog programme. Complete macOS mixed-size/multi-display acceptance before Windows/Linux packaging. |
| Explicit station/location/activity profiles | xLog has station identity, equipment and workspace configuration, but should not collapse radio, antenna, operator and activity ownership into one implicit profile apply. |
| Multi-provider radio/rotator/CW support | xLog already separates radio, rotor and CW ownership. Keep capability-driven controls and stronger observed-state confirmation. |
| Callbook and online-log services | QRZ lookup plus Wavelog, QRZ upload and Club Log foundations exist. HRDLOG, LoTW and eQSL remain independent provider programmes with vault, receipt and reconciliation contracts—not checkboxes backed by shared credentials. |
| Online/offline maps, band-map guides and multiple independent band maps | Maps and independent band maps exist. Beacon/emergency/allocation guides are candidates only after authoritative regional data and operator configuration are defined. |
| QSO filters, activity manager, statistics and awards | xLog has search/filter, workspace presets and award/statistics foundations. Cloneable saved QSO-filter profiles are a useful later candidate; contest activity remains a separate programme. |
| WSJT-X integration | xLog's receive-only Logged ADIF intake is source-complete. CQ/status/color feedback, reply and CAT/PTT choices require separate protocol and authority work. |
| Import/export and service reconciliation | QLog's recent fixes reinforce xLog's existing exact ADIF validation, explicit duplicate/update review and field-preserving confirmation refresh direction. |

## Selected implementation consequence

QLOG-01 (current-source inventory) and QLOG-02 (gap/decision matrix) are complete
at the read-only source boundary. QLOG-03 is source-complete: xLog now has a
native, default-off, passive named-rule owner over its one retained cluster
projection; revision-fenced atomic settings; first-snapshot baselining; stable
identity and bounded semantic repeat merging; a responsive recent-alert table;
and test, clear, add, clone, remove and save actions. Six focused Rust tests,
five focused renderer tests and the production bundle check pass. The code uses
xLog's own retained classifications and identities, starts no second poller and
offers no tune, transmit, CW, rotor or station action. The ad-hoc macOS source
bundle at exact source `527a419e55044b253a4d9a9f267c59c304e93317` passes strict
deep signature verification and the isolated **33/33** integrated acceptance
run with `station_io: false`. Operator, live-cluster and delivery-adapter
acceptance remain separate gates.
