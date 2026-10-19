# Pinned original source and finite compatibility overlay

Source: `oliverbross/contest-sw` commit `7c8b499225a73f7f8f792246881bd7aefc05452f`.
Copied from the supplied Not1MM reset feasibility archive. `upstream/` preserves
the original source bytes. GPL-3.0 license is retained in `LICENSE`.

The source is executed, not translated into contest definitions. Only CQ WW CW
is registered by this host. The other three supplied plugins are retained source,
not supported catalog entries.

`contest_host/upstream.py` applies exact, single-occurrence source overlays at
import time and fails if the pinned source differs:

1. `plugin_common.py`: its two Qt imports target `contest_host.qt_compat`; the
   real `adif_io` import moves into `imp_adif`, which this first host does not
   expose. No fake `adif_io` or PyQt modules are installed into `sys.modules`.
2. `cq_ww_cw.py`: its QtWidgets import targets the finite nonvisual translation
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

Original SHA-256:

| Source | SHA-256 |
|---|---|
| plugins/cq_ww_cw.py | 08f383e8ddb6f02fede9149f5490a1042b71a5cd5e2591ac76b0cf1ba460c3e2 |
| lib/database.py | 855840a01e80e82fc5d7e83c1e7e9f0f367e6db9be504944e0db0173e28e52e8 |
| lib/plugin_common.py | 09872e00c1803b54937bdc449d3445cd97e66cdca4f0003a5fc805ff10236737 |
| lib/ham_utility.py | dd6261db3aa528cf1c13fdaaf7c1816106e2dfa33ff15c45c2a2fd5e0356adb2 |
