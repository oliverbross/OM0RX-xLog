# Antenna profiles, portable defaults and POTA files

Settings → Station contains the software antenna profile collection and portable presets. Add, edit, duplicate or archive an antenna profile; select its bands and optional association with the existing workspace rotor. Save settings explicitly. These are descriptive selections: choosing a profile does not connect or turn a rotor or operate an antenna switch. An owned or uncertain rotor retains its existing Stop controls.

Automatic antenna policy uses admitted native transmit-band evidence, including split TX and radio selection. It operates independently of Follow Radio and never changes the radio frequency or mode. A per-band preference wins; one matching profile is deterministic; overlapping profiles require a choice. Unknown or stale evidence retains the current profile. Operator edits freeze the current draft's metadata; an explicit profile selection applies only to that draft. Saved contacts retain their original profile ID, name, type, bands, revision, rotor reference and offset even when a profile is edited or archived.

The current draft's captured rotor offset is shown beside the raw observed rotor heading. Antenna heading is rotor heading plus offset, normalized into 0–360 degrees. The explicit “Turn antenna to bearing” action subtracts that offset once before using the existing guarded rotor target path. Other existing rotor controls continue to use rotor coordinates. Requested targets are not observations.

Portable presets describe the actual transmitting station: on-air callsign (including suffixes), individual operator, locator, location/subdivision, own programme references, power and optional antenna profile. They never change home settings, Wavelog destination, credentials or transmit authority. Starting or ending a context applies to future blank contacts. The banner offers an explicit application to the current draft. An active context and unfinished draft survive restart through the existing workspace settings and draft backup owners. Entering Contesting retains this Normal Logging context separately.

Own references are separate from the contacted station's reference fields. Unknown offline references may still be logged. SOTA/IOTA/WWFF fields remain available through ordinary ADI/ADX export; dedicated submission output in this release is POTA only.

In Logbook, choose the relevant selected records or filtered population and open POTA export. Freeze the selection and review the preview. It counts physical local contacts separately from derived ADIF records and groups files by recorded station callsign, own park and subdivision. One physical contact from two own parks to three contacted parks produces two ADI files containing three records each. Every record retains the original contact time and on-air callsigns; the local contact remains one record.

Missing own park/location can be assigned explicitly for export only. No value is taken from today's preset to repair a historical contact. Unknown directory membership is labelled for review. Check the subdivision for parks spanning location boundaries. The preview lists excluded contacts; either correct their source records and create a new preview, or explicitly select the displayed valid subset. Potential POTA duplicates remain present, because the programme's duplicate comparison excludes contact time. No timestamps are adjusted.

Save publishes a new `.pota` folder containing all reviewed ADI files and `manifest.json` with rule sources, captured validation instant, counts, exclusions and any export-only assignment. Existing paths are never overwritten. Files are staged and verified before exclusive directory publication. Cancelling publishes nothing. Export does not modify contacts, confirmations or synchronization queues, and does not upload or send anything.

## Official source record

Checked 3 November 2026. The rules page reports version 1.3 dated 18 August 2026 and last modification 4 October 2026. The rules take precedence over guide examples.

- [POTA rules and logging requirements](https://docs.pota.app/docs/rules.html): one own park/location per log, UTC day qualification, station/operator requirements, transmit band, duplicate comparison and prohibition on future UTC dates.
- [POTA ADIF technical reference](https://docs.pota.app/docs/activator_reference/ADIF_for_POTA_reference.html): own `MY_SIG`/`MY_SIG_INFO`, contacted `SIG`/`SIG_INFO`, `MY_STATE`, identity and submode precedence.
- [POTA submission guide](https://docs.pota.app/docs/activator_reference/submitting_logs.html): one file may contain several UTC days; email filename examples are not mandatory local submission actions.
- [POTA park-to-park guide](https://docs.pota.app/docs/activator_reference/park_2_park.html): per-contacted-park expansion, unchanged contact data and exact suffix matching; the upload service handles ordinary duplicates.

Application-defined snapshot fields use `APP_OM0RXXLOG_ANTENNA_*` and `APP_OM0RXXLOG_PORTABLE_*`. They round-trip with the existing arbitrary ADIF-field preservation. `ANT_PATH` retains its established short/long-path meaning. Legacy contacts are never backfilled from current equipment or portable settings.
