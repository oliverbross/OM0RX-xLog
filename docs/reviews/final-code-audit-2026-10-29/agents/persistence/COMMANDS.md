# Command and proof ledger

Repository inspections used lean-ctx MCP and independent inspections were batched via functions.exec Promise.allSettled. No repository mutation/build/GUI/device/transport command was used.

| Invocation | Result | Artifact |
| --- | --- | --- |
| git status --short and git rev-parse HEAD | clean; 0ce97a12bb06f1fb7c501c3f1286ae9bb1aca450 | root owns fetch/FF |
| git diff 530de4c4..HEAD on assigned 12 files | reviewed diff | assigned-surface.diff |
| python3 -B -m unittest discover with -p | lean security blocked -p; not executed and not retried | tool result |
| python3 -B run_tests.py | Python 3.9 import errors datetime.UTC | remediation-tests.log |
| /opt/homebrew/bin/python3.12 -B run_tests.py | 15 tests PASS, 4.854s | remediation-tests-py312.log |
| /opt/homebrew/bin/python3.12 -B probe_wae_replica_upgrade.py | old-peer refusal; documented fresh matching baseline succeeds | wae-replica-upgrade.log |
| /opt/homebrew/bin/python3.12 -B probe_import_country_replica.py | replica score divergence and correction refusal; reopened evidence | import-country-replica.log |
| XLOG_PORTABLE_ONLY=1 swift test --skip-build --scratch-path .build/phase5-20261029/portable-final --filter 'OperatorDraftTests|LegacyADIFTransferTests' | 16 tests PASS; radio agent confirmed shared runner idle; parent owns cached source provenance | swift-core-tests.log |
| shasum -a 256 assigned source files | source hash receipt | source-sha256.txt |
| final git status --short | clean | tool output |
| /opt/homebrew/bin/python3.12 -B build_restore_probe.py | scratch-only standalone Swift compile/link/run exit0 using parent-authorized cached actual core objects; no network or GUI | restore-probe-receipt.json and restore-probe-run.log |

The WAE probe's first attempt rejected an unresolved temporary root because /tmp is a symlink; corrected fixture uses Path.resolve before Host construction. No source change and no production fallback. First suite and initial WAE fixture used automatically cleaned ordinary test temporary directories; later probes set tempfile.tempdir to this agent's runtime directory. The Python suite disables XLOG_CONTEST_N1MM_UDP_ALLOWED; probes also disable XLOG_CONTEST_ALLOW_UDP. No network methods called.

Outside-root lean reads for memory/scratch were denied; no allowlist/config changes. Ordinary permitted ctx_shell tail was used for own scratch logs. No memory evidence used.
