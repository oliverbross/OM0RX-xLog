# WSJT-X CQ local classification — source acceptance, 16 October 2026

## Outcome

Commit `2fab507` replaces the unconditional `Unknown` call/DXCC status on
retained WSJT-X CQ reports with the existing xCluster classification rules over
the current local logbook and current validated CTY resolver.

- The worker builds one cached classification index from the logbook's bounded
  cluster-contact projection. Its cache key contains the private workspace
  generation, durable QSO revision and CTY file identity; only a monotonic
  numeric classification revision crosses the worker boundary.
- Each live CQ keeps its original sender/instance/decode identity and receive
  time. Reclassification changes only `callStatus` and `dxccStatus`.
- A missing workspace, unavailable database, unresolved callsign or invalid CTY
  source fails closed. Call novelty may still be known when the entity is not;
  unresolved entity novelty remains `Unknown`.
- The native Alerts owner tracks activity and classification revisions
  separately. A same-epoch regression is rejected. When only classification
  changes, every retained source identity is already remembered, so it cannot
  be emitted again as a new alert. A genuinely new decode can still match the
  refreshed classification.
- This path remains receive-only. It adds no outbound WSJT-X packet, reply,
  highlight, CAT, PTT, Tune, CW, rotor or contact-save capability.

## Verification

- Focused Swift: `WSJTXActivityTests` passes 8/8, including a real temporary
  logbook changing a retained W1AW report from `New Call`/`ATNO` to
  `Confirmed`/`Confirmed` without changing its decode ID.
- Focused Rust: 18/18 DX-alert tests pass. The new regression proves a retained
  report cannot replay after classification refresh, rejects a classification
  revision regression and permits only a genuinely new period to alert.
- Full portable Swift: XStation 17, XLogPrototype 217 (four intentional skips),
  XCluster 56, plus 414 Swift Testing checks across 56 suites all pass.
- Full Rust/Tauri: 460 unit and 21 integration tests pass.
- Full renderer: 166 files and 2,462 tests pass. TypeScript, Vite production
  build and detached-window bundle checks pass.

The first highly parallel renderer run had one unrelated timing failure in the
detached callsign-intelligence suite. Its focused rerun passed 7/7 and the one
bounded full rerun passed 2,462/2,462.

## Remaining acceptance

This is source evidence after installed alpha.31. It does not establish a new
package or installation. Live WSJT-X UDP, installed popup/sound behavior and an
operator-owned live classification observation remain open. No credential,
network provider, live WSJT-X process, radio, amplifier, tuner or rotor was used.
