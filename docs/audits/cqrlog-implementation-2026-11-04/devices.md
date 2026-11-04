# C03 / C04 device implementation evidence

Baseline: canonical `main` `db4a9ce2739fc8b96371cd432d3b8787e950a45e`,
clean and fast-forward current at programme start. No production store, physical
radio, serial port, keyer or RF output was opened by this lane. Source changes
below are independently implemented; manufacturer documents are protocol
references, not incorporated manufacturer source code.

## C04 coherent software batch

Implemented in the existing `winkeyer.rs` serial actor; no second serial port,
queue, scheduler, automatic reconnect or replay. Preferences remain additive
version-1 configuration. Old port/WPM, macro labels/IDs/colors/bindings and output
choice decode unchanged; missing new fields inherit the device. Optional
composition mode stores only `character`, `word` or `hybrid`, never arm/job state.

| Task | Software state | Evidence / boundary |
| --- | --- | --- |
| C04-T01 | Verified for the finite subset below | Exact primary host-mode source, command matrix below. Electrical qualification Not run. |
| C04-T02 | Verified domain migration | Swift `CWProfileTests` 3/3 includes old settings and new preference/typed-message/configuration round-trip; invalid pairs/ranges rejected. |
| C04-T03 | Implemented; focused owner verified | Pot and ASCII echo are separate from `11xxxxx` status; neither refreshes admission freshness or completes a job. Echo retained to 128 ASCII characters and labelled uncorrelated. |
| C04-T04 | Implemented; focused owner verified | Deliberate idle-only Apply, finite command list, priority cancellation between commands, partial-write uncertainty/disarm, no mode/pin writes. |
| C04-T05 | Implemented | Existing CW settings exposes explicit Save versus Apply, speed source/range, weight, ratio, PTT timing, requested/applied/pot/echo evidence. Packaged controls Not run at this batch. |
| C04-T06 | In progress programme integration | Focused actor 28/28; profile 3/3; existing settings/preview UI 8/8. Combined backup/native UI remains an integrator gate. |
| C04-T07 | Blocked external qualification | No identified connected WK2/WK3 under an approved electrical setup. Next: bounded application/keyer/paddle/Stop observation on firmware 23/30/31; no hardware pass claimed. |

### Exact host-mode authority and supported scope

Primary: [K1EL WK3 documentation](https://www.k1elsystems.com/files/WK3_Datasheet_v1.3.pdf).
The repository's retained `docs/cw/sources/WK3_Datasheet_v1.pdf` identifies itself
as **23 October 2013 / V30**, SHA-256
`d0146e344fabf4be2098bdca6949ecf5bda1ff0dc50e5111cc1d528876bf7c21`.
It was extracted through native PDFKit on 4 November 2026. Its current URL is
also indexed under the later v1.3 title; the retained exact bytes are the
implementation authority, rather than treating those revisions as identical.
Existing recognized handshakes remain 23 / 30 / 31 in legacy WK host mode;
unknown firmware stays rejected. This source provides the WK1/WK2-compatible
commands used here and separately describes WK3 mode; this change does not
issue Admin WK3-mode selection or change register interpretation.

| Operation | Exact bytes / range | Source and evidence limit |
| --- | --- | --- |
| Software speed | `02 WPM`, 5–99 | p7; requested/applied command, no speed readback invented. |
| Pot speed source | `02 00` | p7; physical pot reports remain separate from saved software WPM. |
| Pot range | `05 minimum range 00`, min/range >=5, sum <=99 | p8; both values required; final zero retained compatibility parameter. |
| Pot observation | `07`; report tag `10xxxxxx` | p9; display offset unless this connection applied a known minimum. Not status freshness. |
| Weight | `03 weight`, 10–90 | p7; unset leaves device untouched. |
| Dit/dah ratio | `17 ratio`, 33–66 | p14; displayed setting; actual ratio is 3 × setting / 50. |
| PTT lead/tail | `04 lead tail`, each 0–250 | p8; 10 ms units; tail adds three dit times. Does not manually assert PTT. |
| Two-letter typed prosign | `1B letter letter`, AR/AS/BT/SK/KN | p14; one atomic command, not raw text escape injection. |
| Buffered speed / restore | `1C WPM` / `1E` | pp14–15; existing shared TLF FIFO; disabled with pot source. |
| Stop | Existing `0A` / status query | Priority lane retained; paddle break-in retires host work without clearing paddles. |

Paddle personality/reverse, echo-enable, sidetone and pin/output selections are
**not** exposed as mutable preferences in this finite subset. Changing their
registers safely requires the current complete register value, which the
supported host contract does not read back. Inherit is preserved instead of
guessing unrelated bits or claiming unsupported readback. Echo is shown as
uncorrelated device evidence: host and paddle characters lack native job IDs,
so matching a glyph alone must never complete a host job or be labelled RF.

### Focused validation actually run

* `cargo test --manifest-path prototype/src-tauri/Cargo.toml --bin xlog-prototype winkeyer::tests::`
  — **28 passed**, archive `18965589ffe12c47`; includes existing XOFF/busy/paddle/
  partial-write/priority-Stop checks plus immutable delta append, duplicate
  identity, empty finish, typed merge bytes, pot-versus-speed, partial settings
  failure and status-independent bounded observations. Earlier run 27/28 exposed
  display `<AR>` being fed into literal admission; fixed separate keying-text
  admission while output remains the validated typed bytes.
* `swift test --filter CWProfileTests` — **3 passed**, archive
  `d6833ea02dfde404`. This is the default package's actual core suite.
* `npm --prefix prototype run test:vitest -- src/live/CWSettings.test.tsx src/live/cwMacros.test.ts`
  — **8 passed**, archive `7fa31768491b0ef7`. The subsequent TypeScript command
  in that combined run failed in then-in-progress root `CWComposition.test.tsx`
  matcher typings; this is not recorded as a passing typecheck. Root corrected
  that independently and owns the later integrated typecheck.

Two earlier cargo attempts encountered shared in-progress root/voice compilation
boundaries (missing Session::compose, then voice_audio module/Target initializer).
No assertion or guard was weakened. The final focused run above passed against
the integrated working sources; the committing integrator records the exact SHA.

## C03 current boundary

In progress. Exact ExpertSDR3/TCI commit
`6cbccdd7004858152b4b5b463f9b087432d81a21`, `TCI Protocol 2.1.pdf`, retrieved
4 November 2026, SHA-256
`e60833985619ca6a1c7b5c4c48bdbff59e694924589c238d06557e011e18c074`.
Implementation accepts ExpertSDR3 protocol 2.1 only for new output. Addressed
PTT uses TRX evidence; server-global TX_FREQUENCY is never assigned to a TRX or
invented VFO. CW Stop and macro-speed are server-global, so CW is conservatively
available only for one-TRX configurations. It is whole-message output, with no
incremental/prosign/segmented-speed claim. TCI transmit audio and carrier Tune
remain outside this tranche. Proper live-target tests use
`XLOG_PORTABLE_ONLY=1 swift test ...`; an earlier default-package filter returned
"No matching test cases" and supplies **no** TCI test evidence.

Final C03 protocol/owner/UI tests and commit linkage will be appended after the
coherent native path is complete. No C03 acceptance row is marked passed here.
