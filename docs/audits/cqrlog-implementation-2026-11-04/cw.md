# C05 shared CW implementation evidence

Baseline: clean canonical `main` `db4a9ce2`; imported contract `0dc3c1b3`.
The shared typed keyer/profile primitive is committed as `f56f23f1`.
No production application/data, physical serial device, CAT route or RF output
was used by these checks.

The native `cw_session` retains its one lease/epoch/Stop owner. A composition
submits immutable typed deltas with job, append and native context identities;
bounded actor output remains in the existing WinKeyer FIFO. Ordinary memories
compile through the same typed plan, while the contest Host retains its serial,
preview, one-use output claim and TLF continuation ownership. The existing
provider interface rejects unsupported typed operations instead of flattening.

| IDs | Software state | Evidence / remaining boundary |
| --- | --- | --- |
| C05-T01/T02 | Implemented; focused compiler/owner verified | Typed schema shared with TLF, explicit speed/prosign grammar and native compilation of saved normal messages; independent TS/Rust expected plans. |
| C05-T03/T04 | Implemented; focused input/owner verified | Character/word/hybrid boundaries, staged paste/IME, immutable deltas, one job, accepted/uncertain presentation, Stop and held-draft preservation. |
| C05-T05 | Implemented; focused existing TLF integration retained | Existing actual-Host/native continuation tests run with the new owner; new Host prosign preview/send identity test preserves reserved serial and QSO count. |
| C05-T06 | Implemented; focused dispatch verified | Semantic actions use EP-15 with main/detached registrations, capture/repeat/IME suppression and CW-only child scope. No separate output keydown dispatcher added. |
| C05-T07 | Implemented; profile-domain round-trip verified | Additive optional composition mode; old macros/bindings and unset preferences survive; no runnable state stored. Combined backup/restore remains programme gate. |
| C05-T08 | In progress | Operator help in `docs/cw/CW_WORKBENCH.md`; final integrated source/UI/package and physical boundaries remain separate. |

Focused runs actually completed before the scheduler checkpoint:

* `cargo test --manifest-path prototype/src-tauri/Cargo.toml cw_session::tests:: -- --nocapture`
  — 39 passed, archive `7887e485c71b5e71`; includes new delta/dedup/Stop,
  deliberate-origin/capability, stale draft and lost-reply cases plus actual-Host
  TLF continuation and existing focus/lifecycle/uncertain-release tests.
* `npm run test:vitest -- src/live/CWComposition.test.tsx src/live/cwMessagePlan.test.ts src/live/sharedCWSession.test.ts src/live/cwMacros.test.ts src/live/normalCommands.test.ts src/live/useNormalCommands.test.tsx`
  from `prototype` — 24 passed, archive `71d7440395965d3e`.
* Settings/preview/compiler focused run — 20 passed, archive `921a877c6b51f60e`;
  includes default-mode selector and independent typed-operation preview oracle.
* `npx tsc --noEmit` from `prototype` — exit 0 at this checkpoint.
* `PYTHONPATH=python:python/tests /opt/local/bin/python3.12 -m unittest test_tlf_cw_host test_wave2_messages_host`
  — 14 passed, archive `f860cfc32b0f06c4`, including fixed expected typed operations,
  preview/send equality, no QSO and unchanged serial.

Earlier test setup failures (missing jsdom, unavailable Chai matcher and mock
tuple typing) were fixed without changing product assertions. The existing
unsafe-character error wording was preserved for compatibility. A new Host
oracle exposed an extra base-speed restore after an explicit restore followed
by a prosign; the compiler now tracks outstanding speed change and avoids that
redundant restoration. Integrated voice signature changes temporarily prevented
two Rust compile attempts; they are not passing test evidence. Newer root
changes (contest workbench mounting, ended-keyer-lease reconciliation and
detached EP-15 scope) require the final runs appended by the integrator.

Final scheduler-batch runs: native owner **41 passed** (`1fbfe38aaef26873`),
native message compiler **2 passed** (`3e931d93e3af36a1`), and native backend
**5 passed** (`7492e2e102fd97ad`). The backend now checks durable carrier/PTT
obligations for an independent WinKeyer as well as radio output, while the
keyer still never requires CAT selection. Ended keyer arming (preferences/paddles)
also retires the native lease. A native test proves that an open workbench cannot
let ESM mutate its captured contest draft before the competing message is refused.
Detached/input checks **10 passed** (`a3c8c89d8c155513`); expanded command-scope
checks **5 passed** plus TypeScript exit 0 (`987098b915263850`). Totals overlap
earlier runs and are not added together.

The full affected contest workspace run passed **211/212**; the existing Phone
test-mode claim scenario timed out and repeated the same timeout in isolation.
This exposed an in-progress C06 claim-routing regression, not an accepted test
exception. C06 restores the test-mode claim through the existing Host while
production claims remain native. The unchanged five-second scenario then passed
**1**, with **211 unrelated skipped** (`8b44b1d2e796e3da`). A final integrated
full run remains a release gate; this focused recovery is not labelled 212/212.
