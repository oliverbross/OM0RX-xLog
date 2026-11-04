# C03 / C04 device implementation evidence

**Final integration:** [1.5.13](../../releases/v1.5.13-cqrlog-candidate.md) records
the integrated package and full software gates. Native unconnected settings and
preview scope is distinct from connected TCI/keyer operation. Physical server/
radio/firmware, pot/paddles/keying and release qualification remain Not run.

Integrator portability follow-up: CI run `41841435824` at `9087b323` failed
Swift type checking of the large `LiveTCISession.snapshot` dictionary. It is now
split into explicitly typed PTT/station/capability/TCI dictionaries with the same
keys and values; no protocol/admission behavior or compiler limits were changed.
The local full portable build subsequently compiled that owner. Final runtime
and platform results are recorded in the programme integration/candidate ledger.

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

## C03 software handoff

Exact ExpertSDR3/TCI commit
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

The finite protocol/owner/UI implementation now exists through the actual
React/Tauri/native/Swift owners. The integrating commit records its exact source
SHA; packaged UI and physical evidence are separate gates below. This section
supersedes the earlier in-progress handoff, without relabelling its earlier runs.

### Implemented protocol and lifecycle contract

| Operation | Wire / target / bound | Admission and evidence |
| --- | --- | --- |
| PTT | `TRX:<configured trx>,true/false;TRX:<trx>;` | TCI 2.1 p19. Explicit saved permission, server TX_ENABLE, fresh configured TRX, native exclusive owner. Newer exact TRX readback required for confirmation. No TX VFO or frequency fabricated. |
| Literal CW | `CW_MACROS:<trx>,<literal>;` | pp9/47. At most 128 uppercase supported characters. Reserved comma is encoded `~`; raw `<`, `>`, pipes, semicolons, control bytes and unsupported text are refused. One-TRX server only. Socket acceptance is not RF or completion. |
| CW Stop | `CW_MACROS_STOP;TRX:<trx>;` | p48 global Stop; one-TRX only. Revokes pending revision, bypasses non-release work, requires newer addressed RX before the native Stop can retire its owner. |
| Macro base speed | `CW_MACROS_SPEED:<wpm>;CW_MACROS_SPEED;` | p23, global 1–60 WPM, idle-only. Distinct from paddle speed. Mutations serialize before awaits, so speed cannot cross an admitted active CW job. |
| Observation heartbeat | `TRX:<trx>;TX_ENABLE:<trx>;MODULATION:<trx>;` | Read-only, once per second on the existing explicitly connected supported socket. Freshness comes from producer receipt, not heartbeat send or UI poll time. |
| Queue/echo | Coarse transport acceptance plus addressed TRX | p48 CW_MON is uncorrelated; p49 CW_MACROS_EMPTY occurs when the last character starts. Neither is used to assert RF or finish a native job. No incremental/typed-segment TCI capability is advertised. |

`ptt_session::Target` is now separate from carrier Tune, preserving old serialized
fields and adding exact radio-slot / TCI TRX-channel evidence. TCI does not enter
carrier Tune's target validation. Existing Agent/Flex fields retain their
interpretation. Original-slot release allocates a monotonic native intent even
after the visible slot changes; expected generation and original worker remain
mandatory. Off delivered before On records a native/source tombstone and reads
state only, rather than switching an unowned transmitter off. The older On is
then rejected. A missing legacy slot resolves only through one exact existing
native selection identity; there is no guessed Radio 1 fallback.

Immediate disable uses `tci_permission.rs` only as an orchestrator. The existing
station-selection owner first retains a disable tombstone for the exact worker /
connection. Both CW and PTT admission/dispatch consult it, including when the
worker acknowledgement is lost. Runtime permission disable, targeted canonical
CW Stop, journalled matching PTT off and passive revisioned preference save run
without putting release behind a slow permission response. Failed persistence
or uncertain release produces an uncertain result and retains obligations.
Permission false is persisted with the ordinary save receipt; a retry cannot
rewrite newer setup or reissue an acquisition. A deliberately replaced
connection is the only route eligible for a later reviewed re-enable.

### Task and acceptance accounting

| Task | State | Evidence / remaining gate |
| --- | --- | --- |
| C03-T01 | Verified for finite software scope | Exact source/hash above; explicit 2.1/one-TRX CW matrix. No firmware/RF qualification inferred. |
| C03-T02 | Implemented; source-owner tests pass | Typed encoder, existing socket, producer TRX receipt, framing bounds, generation and output revision fencing. |
| C03-T03 | Implemented; native/source-owner tests pass | Default-off optional saved permission, provider-aware durable PTT, native/source tombstones, original-route release and passive persisted immediate disable. |
| C03-T04 | Implemented; native/source-owner tests pass | Existing CW backend now admits direct_tci via actual send/Stop methods. Whole-message only; explicit base speed, no typed/incremental capability. |
| C03-T05 | Implemented; component tests pass | Existing connection form, TCI panel, CW desk visibility, exact-shape immediate-disable IPC and Connection Doctor advertised PTT/CW projection. |
| C03-T06 | Verified focused software layers | Commands/results below. Combined candidate/backup gates remain with the integrator and are not implied by these focused tests. |
| C03-T07 | In progress: integrator candidate; physical Blocked | Positively isolated packaged acceptance remains a separate integration gate. No identified connected ExpertSDR/radio setup was used. Next: qualify exact server/application/protocol/model/TRX and finite PTT/CW/speed/Stop cases on the approved station. |

| Acceptance | Software evidence | Native/package/hardware boundary |
| --- | --- | --- |
| C03-A01 | Pass at protocol/owner layer: 2.1 versus unknown, one versus multi-TRX, typed bytes and injection bounds | Physical server conformity Not run |
| C03-A02 | Pass at source owner: one injected existing socket, receive/filter/spot/IQ regressions | Packaged native gate separate |
| C03-A03 | Pass at settings/source/owner: default false, saved/restored opt-in, no save output, immediate disable persistence and release despite lost response | Packaged control/restart gate separate |
| C03-A04 | Pass at native/source owner: addressed two-TRX PTT, null TX VFO/frequency, wrong TRX/stale evidence refused | Physical addressed route Not run |
| C03-A05 | Pass at native owner: existing global exclusion plus same-owner/slot/connection fences; unrelated route preserved | Cross-feature candidate gate separate |
| C03-A06 | Pass at native/source owner: lost receipt, retained duty, original worker/slot, Off-before-On and concurrent pending-On release | Physical lost-link case Not run |
| C03-A07 | Pass at encoder/source owner: actual literal bytes, bounds, coarse acknowledgements, no queue-empty RF assertion | Audible/RF output Not run |
| C03-A08 | Pass at source owner: late On retired, Stop revokes pending revision, replacement generation rejects stale requests; receive reconnect tests remain passing | Hardware reconnect/Stop Not run |
| C03-A09 | Pass at finite software adapter boundary: current shared native CW plan/route dispatch; unsupported typed/append paths reject honestly | Integrated native operating path remains an integrator gate |
| C03-A10 | Pass at focused component/source diagnostic layer and receive/legacy regressions | Packaged native control wiring separate |
| C03-A11 | Not run by this lane | Integrator owns one coherent isolated packaged candidate |
| C03-A12 | Blocked: no identified available radio/server qualification setup | Exact operator-approved hardware workflow required; no RF claim |

### Actual focused validation

* `XLOG_PORTABLE_ONLY=1 swift test --filter 'LiveTCISessionTests|TCICommandEncoderTests|TCIWebSocketSessionTests|ConnectionDoctorTests'`
  — Connection Doctor **7**, live TCI **19**, encoder **11**, WebSocket **58**,
  all pass. Retained [raw focused log](tci-focused.log), SHA-256
  `7312d2612d8ed357d9d12c58b12d1a180896efa269079463ae630b68f808c435`.
* After adding immediate-disable persistence/ordering and explicit Off-before-On:
  `XLOG_PORTABLE_ONLY=1 swift test --filter LiveTCISessionTests` — **20 passed**.
  Retained [final owner log](tci-owner.log), SHA-256
  `4b3abb0ced8affffa96eb96a1ef3ecf502369accdf7570c8e43889baa8ab9df5`.
  The earlier broader TCI filter also passed protocol/IQ/receive regression suites;
  totals overlap and are not summed into a new independent test count.
* `cargo test --manifest-path prototype/src-tauri/Cargo.toml --bin xlog-prototype ptt_session::tests::`
  — **10 passed**, archive `990a1c21a148ea1d`.
* Same native command with `station_session::tests::` — **46 passed**, archive
  `c5d952d0b7119a26`; with `cw_session_backend::tests::` — **5 passed**, archive
  `6156759ef72f3f44`.
* Final native `tci_` filter — **15 passed**, archive `f2bff1b11c3f74fd`, including
  native disable-before-ack tombstone, original-slot release, settings receipt
  retry/stale protection and coordinator release under delayed/lost response.
  Coordinator-only **3 passed**, final archive `e659b74968af9dfd` after moving
  PTT journal loading into its independent branch; overlaps this filter.
* `npm --prefix prototype run test:vitest -- src/live/TCIObservation.test.tsx src/live/AgentConnectionSetup.test.tsx src/live/cwVisibility.test.tsx src/live/pttSession.test.ts`
  — **51 passed**, archive `8f15e8355eea50ec`. Includes exact standalone snake-case
  disable-command arguments and replacement-connection refusal before invocation.
* `npm --prefix prototype exec -- tsc --noEmit -p prototype/tsconfig.json` — exit 0.
* C04 follow-up `winkeyer::tests::` — **28 passed**, archive
  `68faf995d3ed134f`; invalid pot offsets cannot claim WPM, and a typed merge
  command advances the output-settle frontier. Recorded in the separate logical
  follow-up `a3ee5fa1` after C04 primitive commit `f56f23f1` and shared C05
  integration `5bbfd87e`.

An intermediate native PTT filter exposed that removing selection admission for
original-route Off also removed a strict worker-identity assertion in the pure
admission helper. The helper's exact identity check was restored; actual release
uses its separate pinned worker/connection route. The existing assertion was
retained. An intermediate UI run 47/48 failed because its historical test expected
no TCI consent checkbox. It now verifies default-off consent and passive saving;
the final 51-case run passes. No manufacturer device, on-air test, production
launch, installed-store write or physical release was performed by these tests.

Operator entry points and scope are in
[TCI and WinKeyer controls](../../cw/CQRLOG_STATION_CONTROLS.md).
