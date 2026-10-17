# Oceania DX CW and SSB pilot contract

Status: source-derived implementation candidate for focused review. It does not claim current sponsor approval, packaged-app acceptance, or cross-platform runtime acceptance.

## Versioned identities and provenance

The bounded registry adds `oceania-dx-cw` and `oceania-dx-ssb`, each at version `1.0.0-source-spike`, edition `source-26.10.11`, and source revision `7c8b499225a73f7f8f792246881bd7aefc05452f`. The translated files are `not1mm/plugins/oceania_dx_cw.py`, `not1mm/plugins/oceania_dx_ssb.py`, and the WPX-prefix algorithm in `not1mm/lib/ham_utility.py` from Oliver Bross's read-only `contest-sw` fork of Not1MM by Michael Bridak, GPL-3.0-or-later.

The existing CQ WW and CQ WPX identities, rule behavior, formatter policy names, durable snapshots, receipts, and canonical mutation bytes are unchanged. Oceania CW explicitly uses the existing `pilot-1` and `pilot-2` formatter policies; Oceania SSB explicitly uses `ssb-pilot-1` and `ssb-pilot-2`. Policy admission remains pinned through each rule's immutable metadata.

## Entry and scoring

Both rules use RST/RS plus positive sent and received serial numbers. Sent serials come from the durable reservation ledger, every commit requires a matching reservation, and the allowed scopes remain session, band, and transmitter. The ADIF capability is `exchangeStrings`: the pinned source writes `STX_STRING` and `SRX_STRING` for these contests rather than numeric `STX` and `SRX`. The later worker/export integration must consume this capability; this core slice does not modify that adapter.

A callsign is a duplicate only when it was already accepted on the same band. A QSO earns points only when the station or worked entity has pinned continent `OC`: 160m 20 points, 80m 10, 40m 5, 20m 1, 15m 2, and 10m 3. Other valid QSOs remain in the log with zero points and no multiplier. Each source-compatible WPX prefix counts once per band, and only on an eligible positive-point QSO. The multiplier is derived from the callsign, never from the entity's canonical country prefix.

Full rescoring after correction or deletion replays contacts in timestamp then UUID order. The pinned source uses a strict `TS < current` database query, so equal timestamps can mark more than one copy of a prefix. The Swift engine deliberately resolves that ambiguity with its existing deterministic UUID tie-break.

The upstream `fetch_wpx_exists_before_me` query (`oceania_dx_cw.py:451–461`, with the same behavior in SSB) counts prior matching-prefix/band rows without filtering eligibility or positive points. An earlier ineligible row can therefore suppress a later eligible multiplier upstream. The port deliberately consumes multiplier keys only from eligible accepted rows, preserving the scoring rule above rather than reproducing that query defect.

## Export and bounded gaps

Cabrillo contest names are `OCEANIA-DX-CW` and `OCEANIA-DX-SSB`; QSO mode tokens are `CW` and `PH`. The serial fields use the existing six-character layout, and the received serial is padded to at least two digits to match the pinned formatter. Single-band projection retains every valid rendered QSO while replaying points and multipliers only for the selected band.

The current entity snapshot already pins the scoring authority needed here: continent, ADIF entity, canonical country prefix, CQ zone, and reference-data version. No reference model expansion is required for operator entry. The upstream ADIF importer can retain an explicit imported `WPXPREFIX`; this bounded port instead derives the prefix from the callsign. Preserving an imported override would require a separately versioned per-QSO resolved multiplier snapshot and remains a documented full-port gap.

Independent fixtures cover a non-Oceania CW station scoring 17 points and 3 multipliers for 51, and an Oceania SSB station scoring 50 points and 2 multipliers for 100. These values are checked independently from the Swift implementation.
