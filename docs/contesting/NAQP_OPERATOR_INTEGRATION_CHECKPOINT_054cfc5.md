# NAQP operator integration checkpoint — 054cfc5

On 2026-10-18, the bounded headless NAQP operator gate completed successfully from clean combined source commit `054cfc55db3d848383559d6d3373eaf948831acb`. The checkout was clean before and after the run, with empty tracked-diff SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`. The fresh SwiftPM XCTest host SHA-256 was `6f10de09e1ff1b8173de451d10fb7adce9f6e7b1be63e711806fa5f6ceb012fe`.

This run repeats the accepted NAQP operator scope after integrating the current foundation at `d2957346466f89eceb1df0421671b5557d064f3e`. It complements rather than replaces the historical clean-source checkpoint at `f687462811c5387b1ad176e4b51a462d8fcdb367` in `NAQP_OPERATOR_ACCEPTANCE_CHECKPOINT_f687462.md`.

The browser drove the production contest workspace and mutation owner through the real isolated `LiveWorker` in a private Contesting Test workspace. It completed six sessions: CW Run, CW Search & Pounce, SSB Run, SSB Search & Pounce, RTTY Plain Log, and a CW DX entrant. The evidence contains 346 ordinary worker frames and three lifecycle frames, 26 contact commits, no serial reservations, 82 visible simulated-output events, and 14 independently parsed Cabrillo/ADIF exports. Each CW/SSB Run or Search & Pounce case committed six contacts and independently asserted six points, five multipliers, and score 30. The run also covered authoritative call-first partial duplicate checks, invalid DX and maritime-mobile location blocking, structured-field preservation through SCP selection, worker restart, correction and deletion, score reduction to five contacts and score 20, and corrected export regeneration. RTTY remained Plain Log.

The complete evidence is stored locally at `/Users/oliver/.codex/acceptance/naqp-operator-integration-clean-054cfc5/evidence/`. `acceptance.json` has SHA-256 `6298da5c79894fde4cb0b11474a612d1f9c2eaacfd7fe5510b9357f3be56660b`; `outer-runner.json` has SHA-256 `989c9b78acb880bd8e2e498abf49c2a09843aaecbc6cb58365717384a6692c69`. Raw build stdout/stderr hashes are `4dc9ca791adcc8696f5492256ada7b46386751f8974862bc8e556d965ed0754a` and `e424a022b9e9c27cdbfba96bcdc9298de4e0978a9b32d8da1db519fb2541be88`; raw run stdout/stderr hashes are `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` and `4a333a7a7343aa42556d62b71a4769a88ab503851abda34b595548dc7fc717a3`. Both forced response and shutdown stalls terminated and reaped their owned process groups with no lingering PIDs. Protected normal and Integrated Preview database metadata remained unchanged.

Before the integration commit, the exact staged union passed 134 `XContestCoreTests`, 72 `XContestStoreTests`, 42 focused worker/SCP/call-history tests, and 182 contesting frontend tests. TypeScript validation and the production frontend build with window-bundle checks also passed. The archived pre-commit logs and SHA-256 values are:

| Check | Log | SHA-256 |
| --- | --- | --- |
| Core and store | `/tmp/xlog-naqp-integration-core-store.log` | `e04924e72eba91df97b5126cebc518a9f8c21db6a355122c66b0f9241e306732` |
| Focused support | `/tmp/xlog-naqp-integration-support.log` | `ee059dd2c1cc61712bc08c89b33d91754bef2bde0869727217796c17f5cafd3c` |
| Contesting frontend | `/tmp/xlog-naqp-integration-frontend.log` | `659c5031d34d11f8af0c2ec3df5efa7366e210bf28f7c8a65787904ad378dafc` |
| TypeScript | `/tmp/xlog-naqp-integration-tsc.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| Frontend build and window checks | `/tmp/xlog-naqp-integration-build.log` | `523f37ba1e87e174cd697f245d9b78b826aeddba1fc4e0a11555b76452306ab9` |

This checkpoint proves a clean-source, headless browser-to-real-worker synthetic operator flow against the combined source. CW and SSB output remains visible simulation only. It does not prove a packaged app, native window or chooser, external generation transitions, RF, PTT, audio, digital keying, hardware, current sponsor compliance, or submission readiness. Protected metadata comparison is bounded evidence, not an operating-system-wide read/write audit.
