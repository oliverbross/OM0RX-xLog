# QLog workflow comparison — 15 October 2026

This is a read-only source and workflow comparison, not a parity claim. xLog
will implement selected ideas in its own architecture and code. No QLog code,
artwork, settings, credentials or logbook data was copied, and QLog was not
launched.

## Evidence and limits

- Upstream reviewed: [`foldynl/QLog`](https://github.com/foldynl/QLog) at exact
  commit [`cbb75f2f2555a4a84c9761e38075754f4821c27c`](https://github.com/foldynl/QLog/commit/cbb75f2f2555a4a84c9761e38075754f4821c27c), shallow-cloned into a temporary
  directory outside the xLog repository.
- A second read-only pass on 15 October confirmed the same commit remains
  upstream `HEAD` and expanded inspection to the WSJT-X UDP receiver, online-log
  service boundaries and saved main-layout profiles.
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
| **Delivery** | Native popup and optional notification sound are implemented as a native-owned, default-off adapter with no action buttons or station authority. Delivery is limited to three notifications per ten seconds; excess matches remain in the dashboard and increment a visible suppressed count. Speech and outbound UDP remain deferred. |
| **Defer** | WSJT-X CQ becomes a possible source only after its receive contract supplies equivalent stable identities; the existing Logged ADIF receiver alone is not a CQ-alert feed. Advanced regular expressions are deferred until bounded evaluation and clear validation can be guaranteed. |

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

## Second-pass reference patterns

- **WSJT-X UDP:** QLog owns one configurable UDP receiver, supports unicast or
  multicast listening, validates the WSJT-X magic before dispatch, parses Status,
  Decode, QSO Logged and Logged ADIF messages, remembers the sender endpoint for
  protocol replies and can forward the original datagram to configured
  destinations. For xLog, the useful pattern is one native socket owner with
  explicit forwarding and visible health. The improvement is stricter schema,
  sender, generation, replay and size fencing before any contact mutation;
  forwarded traffic must never grant CAT/PTT authority.
- **Online services:** QLog separates generic upload/download mechanics from
  provider-specific Club Log, HRDLog, QRZ.com, eQSL and LoTW adapters. xLog
  should retain that separation but require per-provider vault identities,
  durable receipts, idempotency and field-level reconciliation. A successful
  upload to one service must not stand in for confirmation or freshness from
  another.
- **Workspace state:** QLog persists named main-layout profiles containing
  geometry, window state, detail-column choices, extra band maps and appearance
  preferences. This supports xLog's existing saved-preset direction. xLog must
  additionally keep panel content responsive to its measured bounds and retain
  per-window column widths/visibility without letting layout restoration start
  polling, reconnect a device or issue station actions.
- **Adoption boundary:** these are behavioral references only. No QLog source,
  artwork, database, settings or credentials are copied. Each selected feature
  remains an independent xLog implementation with its own tests and acceptance
  gates.

## Selected implementation consequence

QLOG-01 (current-source inventory) and QLOG-02 (gap/decision matrix) are complete
at the read-only source boundary. QLOG-04 (broader WSJT-X, online-service and
layout reference pass) is also complete at that boundary; selected consequences
remain tracked in xLog's existing UDP, provider and workspace programmes rather
than a blanket parity project. QLOG-03 is source-complete: xLog now has a
native, default-off, passive named-rule owner over its one retained cluster
projection; revision-fenced atomic settings; first-snapshot baselining; stable
identity and bounded semantic repeat merging; a responsive recent-alert table;
and test, clear, add, clone, remove and save actions. The next delivery slice is
 also source-complete: a native-owned, default-off popup and optional sound
 adapter with explicit delivery rate limiting, suppressed-count reporting and
 no notification action buttons. Nine focused Rust tests, six focused renderer
 tests and the production bundle check pass. The code uses
xLog's own retained classifications and identities, starts no second poller and
offers no tune, transmit, CW, rotor or station action. The ad-hoc macOS source
bundle at exact source `d37aeb60df831d21f66d33d78ec56d4e4be109af` passes strict
deep signature verification and the isolated **33/33** integrated acceptance
run with `station_io: false`. Operator, live-cluster and actual macOS
 notification/sound observation remain separate gates; speech and outbound UDP
 remain deferred.

The next bounded QLog-inspired condition is source-complete at `6d238e6`.
Named rules may require a literal, case-insensitive **Comment contains** value,
AND-combined with their existing conditions. The value is bounded to 80 UTF-8
bytes, rejects controls and whitespace-only input, and legacy rules migrate to
an empty unrestricted value. Unsafe or oversized source comments cannot match;
the latest safe matching comment is retained as wrapped dashboard evidence.
This is xLog-owned code, adds no regular-expression engine, network source,
poller or station action, and preserves the default-off delivery boundary.
Focused Rust **12/12** and renderer **13/13** tests plus the production build
pass. Live-cluster, packaged and operator observation remain open.
