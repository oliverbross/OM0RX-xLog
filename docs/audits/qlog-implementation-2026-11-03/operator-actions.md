# EP-03 / EP-07 / EP-15 implementation evidence

Date: 3 November 2026. This records source/automated evidence, not packaged, installed or physical-radio acceptance.

## Decisions and ownership

- EP-03 extends the existing passive native DX owner. Configuration version 2 migrates version 1 geography to unrestricted. Existing limits remain 32 rules, 200 history entries and 262144 encoded configuration bytes. Oversized writes fail before atomic publication.
- DX evidence is the classified observation’s ADIF entity, continent, CQ/ITU zones. Spotter evidence is the same classification owner’s spotterAdif / spotterContinent; unavailable evidence does not satisfy a selected criterion. Canonical CTY endpoints supply the searchable entity directory.
- The alert stores an exact sourceEpoch/id/spotVersion reference. Review resolves it again. A current alternative requires explicit selection. One review selection sends at most one native activation request; test and WSJT-X entries have no direct tune authority.
- EP-07 uses fresh retained selected-radio observations. Direct-provider generation, native selection/control epochs and Hamlib generation invalidate reconnects/selection changes. Missing connection identity means no eligible suggestion. Split uses RX.
- Nearby fallback half-widths: CW 250 Hz, phone 1500 Hz. Fresh admitted Hamlib Passband halves are capped at 1000 / 3000 Hz. Suggestion age is at most 10 minutes, same band/mode only. Same-call reports within 50 Hz CW / 250 Hz phone collapse; distinct frequencies remain choices. Ranking is offset, age, stable identity; maximum three over maximum 500 retained reports.
- Nearby uses the canonical callsign-only mutation, revision and durable receipt. Typed callsigns win. Admission uses the editor barrier and selected-radio fence. Unknown acknowledgements retain a reservation until read-only receipt reconciliation.
- EP-15 stores versioned, revision-checked workspace bindings in the existing backup payload. Unknown IDs are unavailable and preserved. Fixed native/CW/contest/emergency/editing chords remain reserved. Optional navigation chords supplement fixed native menu accelerators. Save’s Command/Ctrl+Enter default is remappable through its validation owner.
- Key normalization uses logical keys and platform Primary, preserving composition/dead keys/AltGr. Primary+Alt is unavailable. Repeated save/apply commands do not perform another action. Capture does not invoke a supported command. Native capture registrations are removed on window destruction.
- Shared antenna integration records terminal settlement after current editor instances reconcile the canonical draft. Automatic metadata admission captures an editor epoch, atomically rejecting intervening transactions/membership changes.

## Focused receipts

- Frontend: 9 files / 92 tests passed (commands, capture/conflict, Nearby, alert review, existing DX/activation/registration). A later focused rerun after help/future-version preservation passed 5 files / 25 tests.
- Native before the final persistence fixtures: Nearby 5, DX alerts 24, editor barrier 6, Awards read-only 1 passed. Later source adds a bounded-inventory stress fixture and two alert persistence/bound fixtures; final integration must include those.
- Retained-inventory stress: 100 RX updates over 500 reports in 66.28 ms total in the debug Rust test. This measures the bounded projection, not native GUI/CAT latency.
- Added OperatorActionsIntegrationTests: callsign-only split/manual-field preservation, duplicate durable receipt, typed-call veto, revision conflict, actual backup/restore and restart. OperatorDraftNearbyCallsignTests checks complete-QSO preservation and malformed/typed-call rejection. Integrator owns final portable gate.

## Acceptance mapping and remaining qualification

| Scenarios | Automated evidence |
|---|---|
| A03-01–04 | Geography OR/AND/missing evidence; v1 migration; persisted geography; stale/oversized-save rejection; pure preview; existing dedup/no-replay/retention |
| A03-05–06 | Exact identity UI request; duplicate-click guard; historical/test tune disabled; existing canonical activation/editor/source owners |
| A07-01–05 | CW/phone boundaries, split RX, ties/repeats/multiple choice, band edge, source/slot/reconnect/revision invalidation, input refusal, callsign-only receipts |
| A07-06 | Bounded 500-report projection and measured 100-step stress; no provider/network timer |
| A15-01–03,06 | Versioned backup payload, unknown/future-ID preservation, native-only gates, reserved/collision validation, capture without action, repeat suppression, conflict retention |
| A15-04–05 | Automated platform Primary, IME/dead/AltGr and contextual-route fixtures; existing owner restrictions |

Actual native-window keyboard capture/navigation, rapid-tuning GUI responsiveness, radio/provider effects through Tune & load, physical keyboards and package/install/restore acceptance remain M6 qualification. No app was launched or installed by this lane. No hardware/radio command was used as a test shortcut.

## Review follow-up: shortcut admission and stale reads

Capture is now an explicit acknowledged handshake. Start capture sends a unique requestId; native registration returns the same requestId and active state only after updating its guard. The recording field remains disabled until that reply is verified. Begin/release requests are serialized; leaving a pending capture or unmounting invalidates its reply and queues release. Failed/mismatched acknowledgements retain an error without recording a chord.

Normal command preference reads use a per-read epoch and the authoritative workspace generation from the mounting surface. Accepted bindings carry generation/revision coordinates in the shared renderer store. Old overlapping focus replies, previous-workspace replies and replies older than a saved revision cannot reinstall bindings. Focused fixtures cover these boundaries.

Follow-up focused gate: NormalShortcutSettings6 + useNormalCommands4 + normalCommands4 = 14 tests passed (3 files). No full build was run by this follow-up lane.
