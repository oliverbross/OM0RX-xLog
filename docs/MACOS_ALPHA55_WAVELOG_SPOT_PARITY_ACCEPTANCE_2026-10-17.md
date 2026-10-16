# macOS alpha.55 Wavelog spot parity acceptance — 2026-10-17

## Scope

- Match xLog call and DXCC spot classifications to Wavelog's exact band-and-mode model.
- Match Wavelog's default unworked, worked and confirmed spot colours.
- Keep xLog's existing user-defined colour controls authoritative.
- Migrate saved filters, colours and DX alert rules from xLog's former expanded taxonomy.

## Wavelog reference

- Repository: `wavelog/wavelog`
- Reviewed commit: `7f8eef4de94c674f73c6859ed4e0b0247f68dcd9`
- `Logbook_model::map_spot_status_from_cache` evaluates both callsign and DXCC worked/confirmed state for the exact `band|mode` slot.
- `bandmap_list.js` applies confirmed before worked before unworked.
- `Bandmap.php` defaults are confirmed `#90EE90`, worked `#E5A50A`, and unworked `#CC372D`.

## Implemented parity

| Dimension | New/unworked | Worked on band + mode | Confirmed on band + mode |
| --- | --- | --- | --- |
| Callsign | New Callsign | Worked | Confirmed |
| DXCC | New DXCC | Worked | Confirmed |

- A QSO on another band or another mode does not make the current slot worked.
- Cluster tables, band maps, forwarded radio spots, filters, scoring and DX alert rules consume the same canonical statuses.
- Call status and DXCC status cells use the configured palette independently; Wavelog defaults apply only when the operator has not chosen another colour.
- Legacy custom colours are retained when their former category collapses into New Callsign or New DXCC. Former default colours migrate to Wavelog defaults.

## Verification

- Focused Swift classification, session migration, worker bridge, operator-intelligence and WSJT-X suites passed.
- Focused frontend parity/settings/alert suites: 82/82 passed.
- DX alert native tests: 21/21 passed.
- TypeScript typecheck passed.
- macOS packaging completed once and strict deep-signature verification passed.
- Candidate native acceptance: 33/33 passed with `station_io=false`.
- Installed native acceptance: 33/33 passed with `station_io=false`.

## Installed result

- Installed version: `0.4.0-alpha.55`
- Implementation commit: `5fc0f7c24b5b07ea637639f3c0b22c17794dc490`
- Candidate and installed executable hashes match:
  - UI: `20da2d431dcfd56455d8efbbb4a552cf38c921313d016b8c66aff8b889a40f3d`
  - Worker: `2c2ae67c675b7dcad5f3450e762d6f5fc03242f84d4be8f3ac8a9604a06081a5`
- Rollback app: `/Users/oliver/Documents/OM0RX-xLog-PreAlpha55-Backup-20261017-63QNdR/OM0RX-xLog.app`

## Boundary

The isolated package checks do not claim live radio, external cluster or RF acceptance. The installed app has been relaunched for operator use.
