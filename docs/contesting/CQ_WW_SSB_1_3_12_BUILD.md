# CQ WW SSB 1.3.12 — narrow Cluster/Flex follow-up

Implementation source: `94932a256289b9d7b330ab61d7bbfdb847613d3b`.
The clean version/build commit containing this record is embedded in both
distribution receipts. Exact installed identity and acceptance are recorded in
`CQ_WW_SSB_RECONCILIATION_2026-10-23.md` after installation.

This follows the operator-confirmed stable 1.3.11 spot-click/refocus fix and
preserves that behavior. Scope is limited to three demonstrated defects:

- A successful contest radio-spot delivery receipt was incorrectly parsed by
  the native Cluster session as a replacement spot snapshot. The receipt has
  no spot list, so this invalidated live Cluster state after successful radio
  output. Receipt replies now retain the verified snapshot and activation
  identities. Completed, pending, stale, rejected-delivery and clear receipts
  have regression coverage; worker request authorization remains unchanged.
- Contest phone-range inference overwrote the shared cluster service's FT8
  classification at 7.074 MHz. Preserve the existing digital classification,
  retain explicit comment modes and low-band SSB support, and apply configured
  CQ WW SSB frequency edges consistently to the supplied spot stream.
- Contest Filters used normal-log worked history while a separate Cluster
  checkbox hid contest dupes. Contest Filters now use contest-dupe status and
  coordinate with Show worked. Normal-log filtering retains its existing meaning.

`SH/DX/100` was separately verified to receive 100 reports across all bands.
The reported three-row result was consistent with 40 m mode/band/duplicate and
worked filtering, not missing history transport.

## Validation and release boundaries

Focused frontend regression: 452/452 passed; TypeScript and diff checks passed.
Native Cluster receipt regression: 18/18 passed, including the receipt test that failed before the fix.
Independent review: mode/range, worked-filter and native receipt paths reviewed independently; no blocking findings.

Build once from the clean canonical main checkout with
`bash prototype/scripts/package-macos.sh`. Preserve production SQLite databases
and settings before replacing `/Applications/OM0RX-xLog.app`. Verify embedded
source, signature and package/installed hashes, then run installed isolated
native acceptance and the packaged Python CQ WW workflow in disposable stores.
Retain a verified rollback app. Do not alter production contacts for acceptance.

No test tuning, RF, PTT, audio or rotor actions. Automatic spot-display delivery
is the operator-requested existing service; physical Flex/Maestro visibility
and uninterrupted operation require operator observation. Optional recorded
voice, output routing, PTT and transmitter audio remain distinct untested items.
No Windows/Linux release or additional compatibility batch is included.
