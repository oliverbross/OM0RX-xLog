# Windows history Boolean compatibility repair

Combined source `3f55c1c2d68c068e0e2c9bb1e7cd93d76e6d059b` completed portability run `39080850734` with five successful jobs and one failure: Windows Swift could not import CoreFoundation in `ContestLane.swift`. The earlier SCP shutdown error-code regression was already repaired in this combined source.

The repair conditionally imports CoreFoundation and retains its Boolean type-ID check where available. Other platforms use the established Foundation NSNumber true/false singleton identity check, preserving rejection of numeric and Int8 zero/one values. History confirmation still requires a Boolean.

Root reviewed the narrow two-file source/test diff and verified the following frozen hashes:

| File | SHA-256 |
| --- | --- |
| `Sources/XLogPrototypeSupport/Contesting/ContestLane.swift` | `c76971ae35db8e5a219eb679a5445db0fdb2ff5b876fb459498709af67ec9c13` |
| `Tests/XLogPrototypeTests/ContestingLaneTests.swift` | `c120dd7d5f6c0d06f224c980ee711270d5dbb0d8c6cc7ff27936719bfcada4f5` |
| `/tmp/xlog-combined-portable-bool-repair.log` | `b72c085a41318f0d764bc051e70c3e36e8c4e7f0e5212bca5ef10d2176f0521e` |

The warm portable run used `XLOG_PORTABLE_ONLY=1 swift test --jobs 2 --scratch-path /Users/oliver/.codex/worktrees/xlog-contesting/OM0RX-xLog/.build/arrl-dx-core-integration-portable --filter 'ContestCallHistoryWorkerTests|ContestingLaneTests.testFoundationBooleanFallbackRejectsNumericAndInt8Values'`. Three history worker tests and the direct fallback regression passed, with zero failures. The fallback is exercised directly on macOS; successful Windows compilation and execution still require the new exact-source portability run. No package, installation or radio operation was performed.
