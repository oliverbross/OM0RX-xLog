# Pinned original source and finite compatibility overlay

Source: `oliverbross/contest-sw` commit `7c8b499225a73f7f8f792246881bd7aefc05452f`.
Copied from the supplied Not1MM reset feasibility archive. `upstream/` preserves
the original source bytes. GPL-3.0 license is retained in `LICENSE`.

The source is executed, not translated into contest definitions. The finite
registry supports CQ WW CW, CQ WPX CW, ARRL Sweepstakes CW, ICWC MST, CWT,
CWOPS Open, K1USN SST, Trans Tasman CW and Oceania DX CW.
`source-manifest.json` binds those registrations to unchanged pinned file hashes.

`contest_host/upstream.py` applies exact, single-occurrence source overlays at
import time and fails if the pinned source differs:

1. `plugin_common.py`: its two Qt imports target `contest_host.qt_compat`; the
   real `adif_io` import moves into `imp_adif`, which this first host does not
   expose. No fake `adif_io` or PyQt modules are installed into `sys.modules`.
2. Each registered plugin: its QtWidgets import targets the finite nonvisual translation
   adapter; its export destination changes from `Path.home()` to the host's
   private `export_directory`. All scoring, exchange, ESM and export text logic
   remain upstream code.
3. `Store` subclasses upstream `DataBase`: SQL failures propagate; writes inside
   a host mutation do not commit individually; the known `dirty` column upgrade
   explicitly checks table metadata. Host side tables and a unique DXLOG ID index
   preserve operation/QSO identity without changing plugin columns or SQL.
4. CQ WW's empty `recalculate_mults` callback does not recompute duplicate points.
   The adapter replays retained contacts chronologically through actual plugin
   `points` calls after correction/deletion, then calls `recalculate_mults`.
5. The original `cwmacros.txt` remains byte-identical. The finite output adapter
   maps its four Not1MM substitution names (`HISCALL`, `SNT`, `EXCH`, `SENTNR`)
   to xLog's native CW context tokens; xLog still validates, arms and transmits.
6. ICWC MST's unchanged `icwc_mst.py` was read directly from the repository above
   at the pinned commit (Git blob `32cad0a54771e6f30baa7bec56d75483b2a059f8`).
   The host reserves its sent serial, validates a configured single-token name
   and received `NAME SERIAL` before invoking the original single-space parser,
   and uses the original unique-call SQL/scoring and Cabrillo callbacks. Partial
   name-only history/drafts remain editable. F3 sends `{EXCHANGE} {SENTNR}`;
   no scoring, parser, ESM, database or export source is rewritten.
   Native projections carry the original labels, hidden report fields and
   reserved serial; Stats displays unique calls. The MST log uses a generic
   exchange table. DXCC/zone multiplier windows are unavailable for this plugin.
7. CWOPS Open's unchanged `cwo.py` uses the same reserved-serial authority as the
   other serial contests. The adapter validates the original ASCII-letter,
   two-part received exchange before invoking its parser. It also requires the
   configured sent name to equal the first token of Station Name because the
   original F3 path sends the former while its Cabrillo QSO rows export the
   latter. F3 sends `{SENTNR} {EXCHANGE}`, same-band duplicates remain logged
   with zero points, and the original unique-call score and Cabrillo callbacks
   remain authoritative. No CWO scoring, dupe, database, ESM or export function
   is replaced.
8. Oceania DX CW's unchanged `oceania_dx_cw.py` comes directly from the same
   Git revision (Git blob `01acfd2caca78bd19b3b4c5ba3f04f34bf79c1fe`,
   SHA-256 below). Serial reservation, ASCII integer validation
   and F3 `{RST} {SENTNR}` use the existing host authority. Original plugin
   points, per-band prefix SQL, ESM and Cabrillo callbacks execute directly.
   Its finite compatibility overlay converts SQLite REAL band values to the
   string keys expected by `_BAND_POINTS`; preserves the per-contact points
   already calculated by ordered host replay instead of reusing the final
   contact's duplicate flag during multiplier recalculation; and adds a rowid
   tie-break to the original prefix-before-contact SQL so contacts sharing one
   UTC second do not each claim the same prefix multiplier. The host rebuilds
   after each Oceania commit, correction and deletion to support out-of-order
   contacts. Prefixes remain per-band; zero-point non-Oceania contacts and
   duplicates remain retained in the log. These compatibility corrections do
   not claim organizer certification or installed-app acceptance.

Original SHA-256:

| Source | SHA-256 |
|---|---|
| plugins/cq_ww_cw.py | 08f383e8ddb6f02fede9149f5490a1042b71a5cd5e2591ac76b0cf1ba460c3e2 |
| plugins/icwc_mst.py | 4fcf5971b539a3f7634fea21a752d1a5915d8d11f08c14d0a608a62d57ffb8ca |
| plugins/cwo.py | e162c7e11759cd97322e2d60257f05e47312d997751c2fb2db2b5751872b3a8e |
| plugins/oceania_dx_cw.py | 51d3234f98c3c7ae4c5343cef512545c1a4f41e37a685426724b860def85d664 |
| lib/database.py | 855840a01e80e82fc5d7e83c1e7e9f0f367e6db9be504944e0db0173e28e52e8 |
| lib/plugin_common.py | 09872e00c1803b54937bdc449d3445cd97e66cdca4f0003a5fc805ff10236737 |
| lib/ham_utility.py | dd6261db3aa528cf1c13fdaaf7c1816106e2dfa33ff15c45c2a2fd5e0356adb2 |
| data/cwmacros.txt | 373b6e7ec5fa479da000eed5c89d801ebef03a1e35a494f01ca8792dcb37d9db |
