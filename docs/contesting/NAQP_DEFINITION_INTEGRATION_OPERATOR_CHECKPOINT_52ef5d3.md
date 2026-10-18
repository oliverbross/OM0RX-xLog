# NAQP operator checkpoint after definition integration

On 18 October 2026, the bounded browser-to-worker rehearsal passed at exact
source `52ef5d3dfd264318e04926b49bca44ac7977d47c` on
`codex/contest-definition-integration`. This integrates the isolated 1.2.20
compatibility baseline with immutable contest definition persistence.

## Observed results

- Six synthetic sessions, 345 ordinary worker frames and three lifecycle frames.
- 26 committed contacts, 14 independently parsed Cabrillo/ADIF exports, and 82
  visible simulated outputs.
- CW and SSB each exercised Run and Search & Pounce: six contacts, six points,
  five multipliers and score 30 in each of those four sessions.
- RTTY Plain Log and a DX-entrant CW session each scored one point and one
  multiplier. Correction/deletion produced five contacts and score 20, with
  matching regenerated exports.
- Four call-only duplicate probes produced only QSOB4. Invalid received
  locations, invalid partial DX/mobile input and DX-to-DX contacts were blocked.
- Restart/recovery probes passed. Both outer response/shutdown cleanup probes
  reported no lingering owned processes. Protected database metadata was unchanged.

The runner asserted identical source state before and after execution. Tracked
source had no differences; the user's existing Excel lock file was untracked
and unchanged. This is not described as a globally clean checkout.

## Reproduction and evidence

Run from the isolated worktree:

```sh
node prototype/scripts/run-contest-naqp-operator-browser-acceptance.mjs \
  --expected-head 52ef5d3dfd264318e04926b49bca44ac7977d47c \
  --output /Users/oliver/.codex/acceptance/naqp-definition-integration-52ef5d3 \
  --scratch-path /Users/oliver/.codex/worktrees/xlog-contesting/OM0RX-xLog/.build/arrl-dx-core-integration-portable
```

The output directory must be fresh for a rerun. The original directory is
retained as evidence, with receipts under `evidence/`.

| Evidence | SHA-256 |
| --- | --- |
| `outer-runner.json` | `5855ed4518ac3b089679e9f682e1b0eda9c6852c958cf5aa73bcf2d14116669d` |
| `acceptance.json` | `671440e0caa4356b0c802f013023f2b908975e4ec91ad949333e5eda0d9e41cd` |
| `/tmp/xlog-naqp-definition-integration-52ef5d3-runner.log` | `72b0a08a8ef10f97fda6d20d66d1868c7da420edfd55031f9792b7658b6a4d2e` |

Root reviewed the receipts, exact source, score/export assertions, negative
observations, process recovery and cleanup results, and independently hashed
the retained files. Build and runner exited zero.

## Acceptance boundary and release coordination

This is a headless production Vite UI driving the real isolated LiveWorker
through an XCTest host. It does not establish packaged/native-window/chooser,
RF, CW keying, audio, PTT, hardware or sponsor-submission acceptance. The new
14-profile capability candidate was not included in this source. Catalog status
remains 16 previews, 78 pending and zero fully ported.

The other task, **Move station control into Radio**, was sent the exact branch,
commit, shared-file scopes and continuing 1.2.21–1.2.23 integration boundary. It
acknowledged isolation and no active release collision while testing 1.2.21.
Final integration must reconcile its latest accepted release source; 1.2.20 is
only a compatibility baseline. Canonical checkout, installed app and normal
operator data remain outside this workstream's mutations.
