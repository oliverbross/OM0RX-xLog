# Pinned original source and finite compatibility overlay

Source: `oliverbross/contest-sw` commit `7c8b499225a73f7f8f792246881bd7aefc05452f`.
Copied from the supplied Not1MM reset feasibility archive. `upstream/` preserves
the original source bytes. GPL-3.0 license is retained in `LICENSE`.

The source is executed, not translated into contest definitions. The finite
registry supports CQ WW CW, CQ WW SSB, CQ WW RTTY, CQ WPX CW, CQ WPX SSB,
CQ WPX RTTY,
ARRL Sweepstakes CW, ARRL Sweepstakes Phone, ARRL DX CW, ARRL DX SSB,
NAQP CW, NAQP SSB, NAQP RTTY,
Phone Weekly Test, Weekly RTTY Test, ICWC MST, CWT, CWOPS Open, K1USN SST, Trans Tasman CW,
Oceania DX CW, Oceania DX SSB, SAC CW, SAC SSB, and IARU Region 1
Field Day CW and SSB, plus JIDX CW and JIDX Phone, AADX CW and AADX SSB,
and CQ 160 CW and CQ 160 SSB.
EU HF Championship and IARU HF Championship are also registered as their
original mixed-mode modules.
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
5. The original `cwmacros.txt` and `rttymacros.txt` remain byte-identical. The finite output adapter
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

9. Oceania DX SSB's unchanged `oceania_dx_ssb.py` comes from the same pinned
   revision (Git blob `30f1d5f9a59104bfa17837c99b39ee5182e33aa6`).
   Its scoring and prefix SQL have the exact same compatibility anchors as
   the CW sibling, so it shares only those overlays. Original exchange, ESM,
   multiplier and Cabrillo callbacks still execute. The host defaults reports
   to 59, reserves serials, projects SSB and stores conventional USB/LSB modes
   for the original Cabrillo PH conversion. SSB ESM can log but emits no CW
   actions; CW context acquisition fails. The frontend retains Run/S&P and
   ESM while hiding CW output controls and uses xLog's station tune service.

10. CQ WW RTTY's unchanged `cq_ww_rtty.py` comes from the same pinned
    revision. Its original zone/state exchange, point calculation, three
    multiplier families, per-band duplicate rule, ESM decisions, macro
    expansion and Cabrillo callbacks execute through the Python/SQLite host.
    The registry exposes the original Cabrillo-recognized RTTY submodes. The
    host validates the plugin's zone plus optional state/VE sent exchange,
    keeps the received zone and state fields distinct, and applies the existing
    CQ WW duplicate-eligibility filter to the original state multiplier query.
    A finite non-transmitting digital sink lets original Run/S&P ESM commit
    contacts without manufacturing CW output or claiming an external digital
    modem integration. Country, zone and state matrices remain separate.

11. ARRL DX CW/SSB, NAQP CW/SSB and Phone Weekly Test execute their unchanged pinned
    modules (CW Git blobs `0cf81e0cc8a02e85d410a130f10e69e708b04d31` and
    `d6200061d3f505bb81da47be319442231d2e4dcc`; SSB/weekly Git blobs
    `0e8bbf3f36e4180eadc8686985743f93bb979e85`,
    `f7ff5d4fc24e675132933b9e5f474dfa4a4738a9` and
    `65376835b6d354b027084a4ccdbda5ef7af719c2`). The host invokes ARRL DX's
    original `prefill` callback only after constructing the contact because it
    owns initial per-band multiplier assignment. Original point, multiplier,
    ESM, duplicate and Cabrillo callbacks remain authoritative. Phone Weekly
    Test is bounded to its original 160–15 metre band list. SSB ESM can commit
    contacts but emits no output actions; this port adds no audio or PTT path.
    The original NAQP/Phone Weekly multiplier SQL counts an empty section as a
    distinct non-`DX` section, including on a zero-point non-NA contact; that
    pinned behavior is deliberately preserved rather than silently rewritten.

12. SAC CW and SAC SSB execute unchanged modules from the same pinned revision
    (Git blobs `6fbd04ffa8ea961fa24b7b11282d3bb622d7a080` and
    `334550de17a5a6ffe623105ae7169f13b6a203fe`). They use the existing durable
    serial reservation, numeric received-exchange validation, per-band duplicate
    check and ordered correction/deletion replay. Their original Scandinavian
    point, multiplier, ESM and Cabrillo callbacks remain authoritative. The
    generic serial-macro adapter supplies F3 `{RST} {SENTNR}` from the reserved
    draft serial. SSB remains non-transmitting and adds no audio/PTT authority.

13. IARU Region 1 Field Day CW and SSB execute unchanged pinned modules (Git
    blobs `84e47d7e786f788c3b3b65b265e52a9c5439ee49` and
    `353fc195187c2c38499a00a430d92773ca47eb50`). They reuse the ordinary serial,
    simple-multiplier and per-band duplicate adapters. Portable/fixed-station
    point calculation, DXCC-per-band multipliers, ESM and Cabrillo output remain
    original Python behavior. SSB remains non-transmitting and adds no audio/PTT
    authority.

14. CQ WPX RTTY, NAQP RTTY and Weekly RTTY Test execute unchanged modules from
    the same pinned revision (Git blobs `b7e1f99dee2f87c73833d1f573bfa7f627f422a9`,
    `9556ed1e7ce5dd04d01d3703794fb9e8aa4ff4ed` and
    `6f7d0209633f372f8cc99e89445b374ce9bfe8c0`). All registered RTTY plugins
    use the original byte-identical `rttymacros.txt` through a finite
    non-transmitting digital sink. CQ WPX RTTY owns a durable reserved serial
    in `other_1` and retains the original numeric exchange, prefix multiplier,
    scoring and Cabrillo callbacks. A two-anchor import overlay corrects the
    plugin's unreachable ESM LOGIT predicate from alphabetic to numeric received
    serials while retaining its original button and commit decisions. NAQP RTTY stores the configured sent
    exchange while using the original name/SPC validation, section-per-band
    multipliers and North-American point rule. Weekly RTTY uses the same entry
    fields but preserves its distinct one-point contacts, unique-call
    multiplier and score. Corrections preserve each contact's historical sent
    exchange for the two name/SPC contests, and ordered rebuilds keep original
    duplicate, multiplier and scoring callbacks authoritative. No digital
    transmission or external modem integration is introduced.

15. JIDX CW and JIDX Phone execute unchanged modules from the same pinned
    revision (Git blobs `e236d5158af9498c64bde2f4ba318ca9edcef5a8` and
    `5ba7c6865fb4e6c598dc0e964c88f75bb7eed693`). The host seeds the configured
    prefecture/CQ-zone exchange into the original SentNR field and validates
    both visible exchange fields as positive SQLite integers before invoking
    the original setters. Their original per-band duplicate checks, band-point
    tables, received-number multipliers, ESM decisions, ordered multiplier
    rebuilds and Cabrillo callbacks remain authoritative and distinct from the
    other multiplier families. A CW-only import overlay adapts its obsolete
    visual-container label calls and tuple-style country lookup to the field
    and mapping APIs already used by the pinned phone sibling.
    Phone ESM remains non-transmitting and adds no audio/PTT authority. Both
    modules and their manifest verification remain relocatable with the Python
    host/vendor tree.

16. AADX CW and AADX SSB execute unchanged modules from the same pinned
    revision (Git blobs `6e8493b8c1bf861da6d0c78b1db0a7b3a39026ee` and
    `9ddbedac9637f899422d8d48553c3a1840bd7d5b`). The host seeds and validates
    the configured sent age, validates received ages as positive SQLite
    integers, and rebuilds the original per-band multiplier assignments after
    every commit, correction and deletion. Original Asia/non-Asia point tables,
    prefix-or-DXCC multiplier selection, per-band duplicates, ESM and Cabrillo
    callbacks remain authoritative. A finite import overlay adds a rowid
    tie-break to the original timestamp-only multiplier queries so same-second
    contacts are replayed deterministically. SSB remains non-transmitting and
    adds no audio/PTT authority.

17. CQ 160 CW and CQ 160 SSB execute unchanged modules from the same pinned
    revision (Git blobs `53dbd58b00610cbc09b7154591dd292a66825efd` and
    `309eca9e5325c0ce448df851eecb8963375ae491`). The host restricts both to
    160 metres, validates configured and received state/province/CQ-zone
    exchanges before the original SQL, and rebuilds original multiplier flags
    after every commit, correction and deletion. Original contest-wide
    duplicates, 2/5/10-point country/continent rules, five-point maritime-mobile
    contacts, K/VE subdivision multipliers, DXCC multipliers, ESM and Cabrillo
    callbacks remain authoritative. A finite import overlay preserves the
    original `/MM` non-multiplier rule during replay and adds a rowid tie-break
    to timestamp-only multiplier queries. SSB remains non-transmitting and adds
    no audio/PTT authority.

18. EU HF Championship and IARU HF Championship execute unchanged modules
    from the same pinned revision (Git blobs
    `4cdc89218ba78be158f0dff8d8e64d7dde79db85` and
    `0f2d6999865b5b24872c0e6fd53b6994b1842b11`). The host validates EUHFC's
    two-digit license-year exchanges and IARU HF's ITU-zone or headquarters
    exchange before invoking the original setters. Original continental point
    rules, license-year and zone/HQ multipliers, mixed-mode duplicate rule,
    ESM decisions and Cabrillo callbacks remain authoritative. The generic host
    duplicate adapter now dispatches Not1MM `dupe_type = 3` through its original
    band-and-mode database query, so a session may work a call once in CW and
    once in phone on the same band. Both modules need only the common Qt import
    and private export-directory relocation overlays. Phone ESM can commit but
    remains non-transmitting and adds no audio/PTT authority.

Original SHA-256:

| Source | SHA-256 |
|---|---|
| plugins/cq_ww_cw.py | 08f383e8ddb6f02fede9149f5490a1042b71a5cd5e2591ac76b0cf1ba460c3e2 |
| plugins/cq_ww_rtty.py | 38f63367317c92850ae112ba51931a8db477467a18baca5d7d242ef36f66deb5 |
| plugins/icwc_mst.py | 4fcf5971b539a3f7634fea21a752d1a5915d8d11f08c14d0a608a62d57ffb8ca |
| plugins/cwo.py | e162c7e11759cd97322e2d60257f05e47312d997751c2fb2db2b5751872b3a8e |
| plugins/oceania_dx_cw.py | 51d3234f98c3c7ae4c5343cef512545c1a4f41e37a685426724b860def85d664 |
| plugins/oceania_dx_ssb.py | f60aee6006c4f2da8ee3fdb7d2c2c755a43a8b07897fdd3b6ea1d4592f81c1ee |
| plugins/sac_cw.py | 2c2879d79f59df964e821f5c9ee6a5a460dad93e1c0e04a72b4c3a9ff9aa36ce |
| plugins/sac_ssb.py | c8a8fe6189e79a6fe001de2f73cccd574acc0d26ea8f2f8691765619f1b06fd9 |
| plugins/iaru_fieldday_r1_cw.py | 6a7d67bb87e31ec32fecd4bdd3cbdecb712e2377b773203170d0ac8bf2fcdb9e |
| plugins/iaru_fieldday_r1_ssb.py | 296e36f4786551a80666a99f1a6f6dd58d8195035faba545028add495658e06f |
| plugins/arrl_dx_ssb.py | 357f333526a8cda2f654c84245056cf47cc95bbb0be0c1add64b1e53c3474387 |
| plugins/arrl_dx_cw.py | 50dad8d13b4e782f6a846660f96a96357ae96866dac4ae5787f97818ed00e2d2 |
| plugins/naqp_cw.py | 84da97206ac651638498812dc7867432c883e88650a86571161ca5e3a72b222b |
| plugins/naqp_ssb.py | 551b57f984cbaf4697a3ae9b146ad6f3519a14cc8df0dc9c3f30a7c5fea7c2bc |
| plugins/phone_weekly_test.py | 94770e46c5f16dae2d1bb0482f37011ff48678b49fa547c28cb4902f35bdefae |
| plugins/cq_wpx_rtty.py | 71d8ee0996f91ce3ad0dabaa524aae49bd1197b5313bfeb3d709c15e7b84a351 |
| plugins/naqp_rtty.py | f74bc7f40d257e0f3db7270c8e7b4bec00d6c50c11af37baa8aaa8a7f3f131c1 |
| plugins/weekly_rtty.py | 595cc4514d88fd3c7d8568bf695366a700b4d08c2a491334958e42702df6d02a |
| plugins/jidx_cw.py | 457e6ba45da31a90c06fc9508dee8d1dccf053b0676083c2472082dd61c18e53 |
| plugins/jidx_ph.py | 20b3e8d7154d51c264817a5755d753c2be4bce9896a64d10cb63478837e06860 |
| plugins/aadx_cw.py | 491affb2e8e1a9f64984f30ca95ec8bbf4a4f89788ffdc24f116356dc84df745 |
| plugins/aadx_ssb.py | 5d6d4a6a9dff5f07bb533041ba259bf901ef33a74e31f0a4091a9235333b0bdc |
| plugins/cq_160_cw.py | 45dce6c2caa3ee05e56137e2fee226dae5e1f2434b327b0d3506ae17b804379c |
| plugins/cq_160_ssb.py | db03be688702e523a3d532fabc59e84e689668438e3c3038501a0d82a8b55804 |
| plugins/euhfc.py | 2bec874fc12149a4ab76683b30459141c49f13f5d8423b2dd7c7e263ff68b683 |
| plugins/iaru_hf.py | f8697ee440ee60b85ab88ea499f749294cf379130fa5a4b90fe7ccdb63bc3cde |
| lib/database.py | 855840a01e80e82fc5d7e83c1e7e9f0f367e6db9be504944e0db0173e28e52e8 |
| lib/plugin_common.py | 09872e00c1803b54937bdc449d3445cd97e66cdca4f0003a5fc805ff10236737 |
| lib/ham_utility.py | dd6261db3aa528cf1c13fdaaf7c1816106e2dfa33ff15c45c2a2fd5e0356adb2 |
| data/cwmacros.txt | 373b6e7ec5fa479da000eed5c89d801ebef03a1e35a494f01ca8792dcb37d9db |
| data/rttymacros.txt | 150d819c00a15c5e70fadce632704e13c220bef88012c7777269b3e1bf0638f9 |
