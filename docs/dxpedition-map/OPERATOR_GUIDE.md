# DXpedition Map operator guide

Open **DXpedition Map** from the native window menu. Opening it again focuses the same singleton window.

Browsing is available while Contesting is active and does not switch modules or
change the contest draft. **Tune & load** and **Load callsign** use the existing
Normal Logging activation owner; the operating-module guard rejects them while
Contesting is active. Use the contest's own Cluster/Band Map actions for contest
draft loading and tuning.

- Status tabs are cumulative: Active includes Live; Recent includes Live, Active, and scheduled-on-air operations.
- Band chips describe observed cluster bands, not advertised expedition plans. Search matches callsign, published alias, or entity.
- A card or map marker only opens the detail panel. It never tunes, rotates, or edits the QSO draft.
- **Tune & load** beside a frequency revalidates that retained cluster report, loads the actual reported alias into the shared draft, and tunes the currently selected receiver through the normal activation transaction.
- **Load callsign** appears for a catalogue operation with no retained frequency. It changes the shared draft only and sends no station command.
- `stale/unavailable` means the native cluster projection cannot currently authorize an action. Refreshing or reconnecting does not queue an old tune for later replay.
- Source badges distinguish fresh, cached/stale, and failed providers. Missing Club Log totals, QSO rate, watchers, coordinates, or QSL information display as unavailable rather than zero.

The window keeps its own status/band/language and map-camera preferences. It shares catalogue, cluster, draft, and selected-radio owners with the rest of xLog.
