# CQ WW SSB: N1MM-inspired improvements and operator checklist

The approved CQ WW SSB improvement set was implemented in **1.3.11** and retained
in **1.3.12**. Version 1.3.12 also corrects Cluster/Flex receipt handling, FT8
mode filtering and the conflict between worked filters. This is not a claim of
complete N1MM or Not1MM parity, or support for all contests.

Use the **Contest** menu to open the named contest windows. Settings that change
the operating workflow are under **Contest Setup**. Configuration changes have
a **Save** button. The **N1MM** configuration tab is network-packet output; the
keyboard profile is under **Edit Keys**, not that tab.

| Feature | Location | Try this | Expected result |
| --- | --- | --- | --- |
| N1MM navigation profile | Contest Setup → Edit Keys → Use N1MM navigation profile → Save | With Main Logging focused, use Ctrl+Up/Down and Ctrl+Alt+Up/Down | Previous/next spots follow frequency order; the Alt variants select needed multipliers. These actions can tune the connected radio. The profile is opt-in and replaces the bindings shown in the editor only when saved. |
| Quick correction / return to CQ | Same keyboard profile | Ctrl+Q; Alt+Q | Ctrl+Q opens the last contact editor. Alt+Q returns to the remembered CQ frequency when one is available and can tune the radio. Cancel the editor when only testing its opening. |
| Fast entry | Main Logging | During a real contact, press Enter from callsign, SNT, RCV or CQ Zone | The same logging action runs from each field. Callsign-box frequency/mode commands retain their command meaning. Use a disposable session for invented contacts. |
| SSB tolerance | Contest Setup → Configuration Settings → Options → SSB tuning tolerance (Hz) | Inspect the default 300 Hz or set your preferred tolerance and save | Small VFO adjustments retain the current station; departing beyond the anchored tolerance triggers radio-follow behavior. |
| Contest frequency edges | Contest Setup → Configuration Settings → Bands | Inspect 40 m Phone start/end | Default 7.050–7.200 MHz; the CQ WW SSB display honors the configured limits. Existing FT8/digital classification remains digital even inside that range. |
| Stable Band Map | Band Map | Click a spot, refocus Main Logging, and then log a real QSO | Selected call remains at the spot's true frequency; focus changes create no extra Heard spots. Only affected classifications/visibility change after logging. Some movement is expected when reports arrive, expire or the chosen range changes. |
| Colour meaning | Band Map, Cluster and contest spots sent to the radio | Compare needed and worked stations | Green = double multiplier; red = single multiplier; blue = valid QSO without a multiplier; grey = dupe/non-workable. Pending classification is separately amber/dashed. Worked Band Map calls use plain grey text. |
| Worked filtering | Cluster → Filters → Worked in this contest; Cluster toolbar Show worked | Select worked, then toggle Show worked off/on | Contest dupes are included when requested, regardless of normal-log history. The controls reconcile conflicting selections. Age, band, mode, frequency, source and other filters still apply. Cluster Show worked is local; Band Map Show worked also controls contest radio forwarding. |
| History retrieval | Cluster → SH/DX/100 | Press once while connected | Requests 100 reports across all bands. It does not promise 100 unworked 40 m SSB stations. Duplicate, age, band and worked filters reduce the visible count. |
| Filter explanation | Cluster toolbar → Filter details | Expand the counts | See how supplied, band, worked and multiplier filtering affect displayed rows. |
| Column layout and sort | Cluster / Log Display table headers | Drag a header, resize its edge, click a header to sort | Order and widths persist. Cluster supports primary/secondary sorting. Log sorting is explicitly for the displayed page, not a full-database sort. |
| Log pane sizing | Log Display divider between chronological log and partial matches | Drag the divider | Both areas resize without recreating the log; the split persists. |
| Multiplier exploration | DXCC / CQ Zones | Change Band and Show between Worked, Needed, Spotted-needed and All | Views use configured/current/all bands as selected. DXCC includes the CTY primary-entity universe, not just already logged countries. Use the Continent filter where available. Available spot links use normal selection/tuning. |
| Rates and target | Rates | Resize vertically, inspect hourly chart, enter an Hourly goal | UTC/local clocks and elapsed time since last QSO update; hourly totals include quiet hours; goal is saved. Scroll if the graph is below a compact window's visible area. |
| SCP space and sources | Check Partial → Panes | Toggle source panes; widen the window | Chosen panes persist and results use available columns. Exact callsign matches are emphasized. |
| Exchange advisories | Main Logging / Log Display | In a disposable session, enter a valid but reference-mismatching CQ zone | A zone/history advisory appears; the valid received value is not silently overwritten and remains the logged exchange. |
| Map and footer | Spots Map / Main Logging footer | Type a resolvable call with no cluster report | The current entry target can produce the home-to-DX path and rounded heading, long path and distance. Accuracy depends on available grid/location data; a country-level fallback is approximate. |
| Continuous Flex delivery | Flex/Maestro display during ordinary operating | Observe new reports and retained spots for more than 10 minutes | Eligible, classified contest spots continue to update/renew; Show worked changes their eligibility. Delivery acknowledgement is separate from physical display confirmation. |

For an operator trial, start with read-only layout, Rates, SCP, filter and
multiplier checks. Exercise logging/edit/delete/export with invented contacts
only in a disposable contest session. No RF or recorded voice is needed for
these checks. Normal operation with real contacts provides additional evidence.

## Known boundaries

- Old false Heard overlays created before the fix are not automatically deleted;
  they cannot be distinguished reliably from genuine manual observations. They
  expire normally or can be removed individually by the operator.
- Recorded voice files, output routing, PTT and transmitter audio are separate
  optional acceptance items. Macro substitution does not validate them.
- The automated tests and package checks do not establish uninterrupted physical
  Flex/Maestro display operation or acceptance on Windows/Linux.
- Refer to [the acceptance record](CQ_WW_SSB_RECONCILIATION_2026-10-23.md) for the
  exact installed commit, test evidence, remaining limitations and rollback.
