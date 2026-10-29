# Independent readiness draft QA

Reviewed `/tmp/xlog-phase7-20261029-b8926639/RELEASE_READINESS.draft.md`, SHA256 `10cf114e879b773da615fabaaa20483464108d9963653d701ceb596acbc2a717`, against frontend raw receipts/results/preservation, the shared completed receipt ledger and preservation/scope/Swift qualification records, data and Rust validation reports, relevant claims in all six historical root reports, current source boundaries, and saved OSV results. This was read-only QA: no test rerun, dependency swap, draft/canonical edit, provider/hardware/native application operation, or Git mutation.

## Acceptance

No concrete count, frontend evidence-boundary, open-finding, warning, preservation, or source/provenance inaccuracy was identified in this draft. The NO-GO recommendation follows the documented High-defect criterion and the incomplete product acceptance matrix. Passing existing checks does not imply the failing new requirements passed.

Specifically checked:

- Frontend: actual exits 0, 6 Node plus 4,742 Vitest / 339 files, runner 850.310 s, build 36.638 s, 24 gates and Logbook 405,194/405,200 bytes agree. React act and Vite large-chunk warnings remain disclosed.
- Scratch totals: seven unique cases, four failed requirements/three controls, selector overlap and 195 intentionally skipped old cases are accurately distinguished from the complete mandatory pass. FA-014 has three unique failing rendered requirements; FA-017 has one. Backend/native timestamp and release behavior remain explicitly simulated; no SQLite/native GUI/RPC/RF reproduction is claimed.
- Preservation: original node_modules inode 560040948 and 180 dist hashes match frontend evidence; 983 frontend tracked hashes match. Shared preservation records 1,838 inputs/six historical reports unchanged. Current HEAD and origin/main independently read as `b892663915cbc0768b26dc5a7bf7ec116869e409`; Git status empty.
- Shared ledger: 35 completed receipts; only the three frontend intended-behavior probe commands and retained first generator setup command have nonzero exits. The 25 named standard commands are separately enumerated as exit 0. The first incomplete Rust feature run is excluded as an accepted pass.
- Swift qualification: native 330 XCTest and 340 Swift Testing summary; portable 1,191 XCTest/six skips and 541 Swift Testing summary; TSAN 71 XCTest plus 21 Swift Testing; strict 119 source-warning headers/112 distinct diagnostics agree with current qualification JSON. Warnings and disabled cases are not represented as clean/full language-mode qualification.
- Reports/open IDs: current final audit preserves FA-010 High plus FA-011–017 Medium; three findings have executed counterexamples/five remain runtime-unverified. Earlier scoped roots remain distinct; the tracker’s historical unconditional emergency RX wording is expressly corrected.
- Scope/removal wording: 34 commits/79 changed inputs/no deleted tracked inputs and unchanged public manifest entrypoints agree with the scope record. The draft expressly refuses to treat this as proof every legitimate workflow survived.
- Security: fresh npm zero-advisory result is kept separate from OSV command success; 549 queried versions/six matched packages/seven alias-inclusive raw IDs agree with saved OSV JSON. Conditional GLib and maintenance debt remain open, without an application exploit or seven-vulnerability count claim.

## Publication dependencies

The platform section intentionally remains `PLATFORM_RESULT_PENDING`; it needs the actual test-only CI 40816487097 result with its job/runtime/package boundaries before final publication. This known placeholder is not a newly found defect.

The draft excludes block-buffer 0.10.4 using a current maintainer range, while saved OSV data retains its broader introduced=0/fixed 0.12.1 range. Root confirmed direct Phase 7 `tools.web__run` opens of GitHub's primary maintainer advisory (affected >=0.11.0,<0.12.1; patched 0.12.1) and the primary RustSec GLib advisory (patched >=0.20; affected functions >=0.15,<0.20), and will record their provenance in `primary-source-review.json`. This resolves the QA provenance question without replacing or concealing the raw OSV data. No security-claim correction is required.
