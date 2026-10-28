# Phase 5 stability convergence — 29 October 2026

Started on clean canonical main at **721e070561c1e2ce068e1dc118e5d0db47a374f0**, fetched and fast-forward checked. Authoritative history: CODE_REVIEW.md, REMEDIATION_TRACKER.md, REGRESSION_TEST_REPORT.md and REVIEW_COVERAGE.md. Earlier evidence remains immutable. Production data, credentials, installed applications and physical station/RF operations are excluded. Builds and simulated integration checks do not establish hardware or installed-app acceptance.

## Remaining failures at entry

| Item | Classification / starting disposition |
| --- | --- |
| REG-P4-001 / reopened CR-008 | Medium confirmed clean frontend build regression; timestamp tests pass but npm-lock build exceeds the unchanged Logbook budget by 18 bytes |
| REG-P4-002 | Low pre-existing strict Swift concurrency compiler error in the default cluster callback |
| REG-P4-003 | Low pre-existing process acceptance fixture missing the selected Python/CA/Not1MM runtime |
| INV-P4-001 | Repeated NAQP simulated CQ failure; application/harness root cause and origin require investigation |
| INV-P4-002 | CW profiler overload deadline observation; idle-load pass exists, sustained contention/whole-app soak remains unqualified |
| Security review | Conditional Rust advisory matches require current feature/caller/patch review; no confirmed application exploit or integrity loss was established in Phase 4 |

## Iteration 1 — reproducible frontend dependencies

The clean npm install reproduced the existing failure before repair (BASE-FRONTEND-BUILD, exit 1, 405,218 bytes). An initial control updating React/ReactDOM/Tauri API to the local pnpm versions still emitted 405,218 bytes; those package changes were preserved as an investigative diff and restored. A deeper complete dependency comparison identified Rolldown **1.2.13 vs 1.2.15** and its matching native binding/types. Updating only that allowed transitive toolchain in the integrity-checked npm lock restores the clean build to **405,194 bytes**, matching the prior local-tree result. package.json, application code, the 405,200-byte gate and timestamp/power validation remain unchanged.

Regression coverage retains the existing production graph/byte-budget gate and strengthens canonical time provenance tests with explicit true/false/omitted acceptance and malformed/null/boxed boolean rejection. **PASS:** fresh `npm ci`; `npm run build` (TypeScript, Vite and all unchanged window graph/budget gates); 122 focused tests across five time/draft/power/remount files. The failed runtime-package control also passed those tests while failing the bundle gate, separating behavior from emission size. Complete regression verification follows the repair batch; no full convergence claim is made here. Stability improved: REG-P4-001's targeted build failure is resolved, CR-008's final acceptance awaits the full cycle. Strict compiler, worker fixture, NAQP and security review remain open at this iteration boundary.

Execution scratch: `/tmp/xlog-phase5-20261029-721e0705`; fresh build products: `.build/phase5-20261029`. Original node_modules and dist were moved intact to private task preservation paths with inode/hash receipts before fresh installation. Command receipts retain actual arguments, timings, exit codes and raw output. Durable evidence will be archived with the final report.
