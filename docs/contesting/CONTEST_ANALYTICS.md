# Contest Analytics

Source implementation, 25 October 2026. Open **Contest → Analytics…** in a build containing this feature, with a contest session active. The working installed 1.3.12 application has not been replaced by this work.

This implements the first analytical delivery from Oliver's `OM0RX_xLog_Contest_Analytics_Design_2026-10-25.md`, plus a bounded comparison of saved xLog reports. It builds on the existing Python contest owner and the native admission pattern coordinated with the **Not1mm** task. Log Review (`0b468867`, acceptance notes `82cf487e`) remains a separate utility.

## Operating and exploring

- **Overview:** host claimed score beside explicitly separate display counts; full contact/event-range timeline with 5/10/15/30/60-minute buckets, cumulative contacts, QSO points, CQ WW multiplier acquisition and reconciled score growth. Recent fixed 10/30/60-minute rates, hourly goal/delta, strongest fixed intervals, last contact and band contributions.
- **Timeline & Explorer:** finite row/column dimensions (UTC date-hour, band, mode, country prefix, continent, CQ zone, operator, Run/S&P, WPX prefix), presets, heatmap, contacts, distinct calls, points, new credited multiplier events and percentage share. Distinct totals are recomputed, not summed across cells. Large cross-tabs page rows/columns.
- **Multipliers:** CQ WW CW/SSB country-band and received-zone-band acquisition, full-category supporting contacts, single-support filter/search and a conditional contact-value calculator. The host supplies multiplier eligibility using its existing country/nonduplicate credit filter; zero-point domestic contacts are included. The calculator takes explicit points/new-key assumptions, does not predict reception and never activates a spot.
- **Operating Performance:** saved Run/S&P/Unknown counts, points, points/contact, acquisition and operator contributions. Duration, radio and antenna comparisons show their coverage limitations.
- **Compare:** import a complete exported xLog analytics JSON report as a separate read-only dataset. Compare elapsed-hour counts/cumulative counts and normalized per-band contributions. Enter both event starts for event-time alignment; otherwise the view explicitly aligns to each log's first contact. Category, plugin and CTY differences are called out. The comparison table covers up to 168 elapsed hours.
- **Quality & Review:** missing/invalid fields, timestamps after snapshot capture, attribution gaps, duplicates, source/reference identity and calculation basis. This is not official adjudication. Existing Log Review provides the separate country/spot evidence workflow.

Display filters apply across sections: band, mode, operator, style, continent, category/all-log inclusion, logged/known-nonduplicate basis and UTC range. They do not change category, submission scope, entry draft or contacts. Empty UTC endpoints use the contact extent; explicitly enter event endpoints to include empty hours outside that extent.

Select a metric, timeline bar, table cell, multiplier or finding for paginated contributing contacts with stable QSO IDs. This list is read-only and offers CSV export with spreadsheet-formula escaping. **Export report** saves complete normalized contacts, metadata, filters and claimed basis as JSON; **Print / PDF** invokes the webview's print flow for the current section (native print-dialog acceptance remains pending).

## Metric and evidence contract

- Compact Rates now uses a fixed full 60-minute denominator for its last-60-minute logged rate. Exact hour starts count consistently. Invalid timestamps are excluded and counted; missing Run/S&P is unclassified. The separately named 10/100-contact pace retains the established `N / (N−1 intercontact interval span)` convention.
- Analytics recent rates use fixed wall-clock windows. Their denominator can include time before the first logged QSO; this is explicitly stated. They are not QSOs per operating minute.
- UTC display buckets and selections use `[start, end)`. The rolling window evaluates logged timestamps up to the captured evaluation instant. Quiet bucket zero means no matching logged contacts, not proof of an observed monitoring interval. Partial buckets are distinguished.
- The authoritative claimed score comes from the pinned host/plugin. All-log/display-subset points never replace it. CQ WW reconstructed score history is enabled only when complete category data reconciles with host points, multiplier total and score, and duplicate ordering agrees with host credit eligibility. Otherwise it is unavailable. A corrected-log reconstruction is not an immutable record of what was displayed during operation.
- New credited multiplier events are established over the full category log before display filtering. Filtering away the first supporting QSO cannot create a new multiplier. Support counts remain over the complete category log.
- Generic contest contact/point/dimension exploration is supported. CQ-zone semantics, multiplier keys and historical score adapters currently cover **CQ WW CW/SSB only**. Other plugins retain their host score and explicitly unavailable historical/credit measures. Unsupported duplicate types remain Unknown.
- Known zero-point contacts are not classified as invalid. Unknown points, country, operator, style and duplicate interpretation stay visible. Country labels and continents come from saved identities, not current laptop location or invented geographic inference.

## Architecture and bounds

`python/contest_host/analytics.py` owns ephemeral copies through `contest_analytics` prepare/page/check/release requests. Prepare briefly copies at most 50,000 contacts and the authoritative score under one existing SQLite read transaction, then releases it before normalization and serialization. Pages contain at most 500 normalized contacts; at most two copies live for 15 minutes, extended by valid reads/checks. No journal-mode/schema migration or second database writer is introduced.

The invalidation token covers the QSO audit sequence/count, pinned reference identity, plugin, category settings and station. Draft revisions and lazy country hydration for a newly typed call do not invalidate it. Correction, deletion, recalculation and scoring context changes invalidate copies. Native admission pins the active session/workspace and worker generation before and after each read. The renderer rejects inconsistent pages, duplicate IDs and a log changed during collection.

The dedicated label-scoped native bridge admits only copy reads, bounded pages, checks and releases. It cannot edit/log contacts, tune, transmit, insert hypothetical QSOs, send spots or enable a network service. The detached renderer reuses an immutable dataset in its own Web Worker. It yields between page reads, supports cancellation and rejects superseded calculations. Optional live refresh checks every 15 seconds while visible, copies again only on log/context changes and advances recent-window calculations locally. Hidden windows pause automatic checks.

Timeline aggregation is bounded to 4,096 buckets. JSON import is bounded to 32 MB / 50,000 contacts, validates field types and IDs, and derives scoring capability from the allowlisted plugin identity rather than trusting an imported capability flag. Normal windows lazy-load no analytics UI or worker; the production bundle check asserts this. Analytics adds small preload metadata to shared startup; the measured Logbook graph is documented in acceptance evidence.

## Deferred work

The design's later stages are not represented as delivered capabilities: score-aware spotted-needed ranking using the existing candidate preview, Cabrillo/ADIF reference datasets, official LCR/UBN import, comparative map layers, multi-log comparisons beyond two, measured operating-state/radio/antenna attribution, historical target plans and projections. Existing DXCC/Zone spot matrices remain available in their original windows.

No current event-year rules certification, installed Analytics menu/IPC acceptance, production-log changes, RF operation or provider-account validation is claimed by source tests or synthetic screenshots. A coordinated version-advanced canonical package, exact provenance and disposable-workspace installed acceptance are required before replacing the active operating build.
