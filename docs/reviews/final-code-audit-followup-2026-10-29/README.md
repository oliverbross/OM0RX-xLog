# Independent Phase 6 follow-up evidence — 29 October 2026

Audited canonical `main` at `0375a8e1a385252519a99127fe9d8f40d639365a`, application `f3f6e3dee40af29cb6801ef8ee422c521629e168`, version1.3.60. No application/test/config/dependency edits or live application/provider/hardware/RF operations. Report/evidence only.

Read [the final audit](/Users/oliver/Documents/Projects/OM0RX-xLog/FINAL_CODE_AUDIT.md) for severity, failure mechanisms, original-finding dispositions, release criteria and Phase5 return. Eight findings: oneHigh/sevenMedium; three executed counterexamples and five source-confirmed runtime-unverified mechanisms. No introduced application regression established. Previous report preserved as PRIOR_FINAL_CODE_AUDIT.md (SHA256 b4ec929f38cfa5b0989c72320f6e337a82b8f485ddf5a00bb151839778830104).

- COMMANDS.md, environment.json, root-checks.json and per-check receipts: commands, actual outcomes and cache boundaries.
- changed-input-coverage.json: all79 changed inputs; latest-remediation-paths.json identifies32 latest followup inputs. Compressed diffs preserve comparisons.
- agents/*/coverage.json and root-coverage.json: function/caller/test depth; audit-qa.json validates329 explicit ranges across90 current keyed paths. historical-coverage-followup.json maps70 frozen-inventory paths (27partial/26scan/17full), without automatic whole-file promotion.
- agents/*/REVIEW.md and frontend/FLDIGI_REVIEW.md: independent source-first scopes, rejected hypotheses, evidence and limitations. Local candidate IDs map to root FA-010–017 in finding-evidence.json.
- agents/data/country-reconcile-result.json: actual Host failure and rollback. agents/frontend/*-r2.log.gz and fldigi-stop-r3.log.gz: intended-behavior requirement failures and passing controls; first attempts also retained.
- source-sha256.json and preservation-before-publication.json:1838unchanged source inputs and five historical reports preserved. disposable-db-integrity.json: only two private fixture databases read; both clean, no production data accessed.
- artifact-index.json records original and saved byte counts/hashes; gzip uses fixedmtime0. SHA256SUMS covers every evidence file except itself. verify_publication.py.gz validates the report, immutable prior report, archive, ranges, source and permitted Git paths.

All probe sources are audit artifacts, not installed application tests. Decompression does not authorize running a provider or using production roots. No executable binary, fixture SQLite/runtime tree, dependency cache or symlink is archived. Compilation is not execution; the agent-stop compiled binary is explicitly stale, and TCI/data binaries were tool-blocked. No bypass attempted. A missing raw agent compile/Python stdout log is not fabricated; the actual summary/source receipts and boundaries are stated in COMMANDS.md.

Earlier review/remediation/stability evidence directories and the other root reports are unchanged. Full manual review and installed/native/provider/hardware/physical acceptance remain incomplete. Passing existing tests does not erase the new failures.
