# Phase 5 portability review

Reviewed clean HEAD `0a7e74ab3988537176551aea4a40ed48a012d7af` read-only. No builds, GUI, app launches, hardware access, production access, or repository edits performed.

## Confirmed findings

**P2: The new portable cleanup regression cannot pass on Linux or Windows.** `Tests/XLogPrototypeTests/LiveClusterMethodsTests.swift:352-365` expects one accepted delivery, a recorded forwarding callback, and then another accepted delivery. `Sources/XLogPrototypeSupport/LiveClusterMethods.swift:171-176` unconditionally reports `forwardingAvailable == false` off macOS. `reconcileContestRadioSpots` constructs desired spots only inside that gate (`:896-921`), so injected callbacks cannot produce the required acceptance/forward lifecycle there. This is a test portability defect introduced by the new case; it does not establish a production forwarding regression. The current contest portability CI discovers this suite but its execution filters omit it, so passing discovery cannot validate the new portable case. Preserve forwarding and cutoff assertions with a fixture capability or an appropriate separate platform-specific assertion; do not reduce the oracle to silently accept zero forwarding.

**P2: The native-broker compile repair is incomplete.** `freshPersistedContestRetirementWithoutClusterConfiguration` (`:616-649`) and `retirementDrainsDelayedFreshContestAcceptance` (`:651-712`) still reference `SpotForwardBroker` and `payload.flexSpot()` outside a platform guard. The broker's whole file is `#if os(macOS)` (`Sources/XLogPrototypeSupport/LiveSpotBridge.swift:1`), and `flexSpot()` is also Mac-only (`LiveClusterMethods.swift:33-39`). These pre-existing fixtures will still prevent portable test compilation after the newly guarded first fixture is removed from that compilation. `SpotInventoryStore` itself is portable and is not the missing dependency. Guard only the native fixtures while preserving their Mac assertions.

### Portable regression recommendation

No production capability override is necessary. Clock capture (`LiveClusterMethods.swift:844`) and cleanup scheduling (`:850`) occur outside `forwardingAvailable`. Preserve Mac first/second acceptance and forward-before-cleanup assertions. On non-Mac, assert first and second accepted/removed/unchanged/rejected are zero, pending and stale are false, and revisions/workspace identity match the publications. Assert top-level `flex_forwarding_available` and `tci_forwarding_available` are false, recorder forward/removal arrays are empty, lifecycle is exactly `["cleanup"]`, and cutoff remains exactly `[admission]` after both publications. After polling, explicitly assert `forwarding.prior_spot_cleanup_pending == false` so a timeout cannot silently satisfy the test. This proves admission-clock and one-time cleanup behavior while verifying unsupported forwarding stays denied.

The existing callback cases `pendingPriorCleanupDoesNotBlockFreshPublication`, `slowPriorCleanupIsOwnedAndNonblocking`, `contestRadioSpotPublication`, `contestRadioSpotLeaseRenewal`, `contestTCICallsignReconciliation`, and `contestShutdownRetainsRejectedWithdrawal` also assume Mac forwarding capability. Executing the whole suite off-Mac would produce expected-capability mismatches; execute the purpose-built portable case explicitly instead of weakening these supported-Mac assertions.

## Other reviewed areas

No other actionable confirmed issue found in the bounded review:

- Windows FFI signature and flags match `MoveFileExW`; UTF-16 buffers stay alive across the call, the parent is canonicalized without following the destination filename, embedded NUL is rejected, and cross-volume copy is not enabled. `NamedTempFile::into_temp_path` closes the file before rename; local tempfile source confirms `TempPath` drop only removes its stored path. Thus publication cleanup cannot remove the destination, and tombstone cleanup cannot restore a consumed journal name.
- Preference commit still publishes before changing selected/context state and preserves the active transition fence on failure. Restart intent keeps schema/version/known-route and expected-destination checks. Native transition preparation, idle, retirement, and restart authorization gates are unchanged by this repair.
- The CoreFoundation guard preserves the original CF type check on supported platforms. The fallback uses canonical Foundation boolean identity rather than permissive Bool or objCType conversion; new tests cover JSON booleans versus numbers and wire admission without relaxing schema/range/counter checks.
- The Mac broker fixture is appropriately conditional on the module that owns the omitted broker. Its original receipt inventory assertions remain unchanged.
- The four added IQ files contain Foundation-only types/parsers/metadata. The isolated checker copies the actual non-Mac manifest source list and three existing regression files without altering their assertions.
- Windows shutdown count now exactly matches seven existing shutdown test functions; no shutdown test was removed or skipped.

Windows API contract checked against https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw . The API documentation describes replacement and write-through operation, but this static review and ordinary unit/CI runs do not constitute crash/power-loss or all-filesystem qualification. Root owns exact-job CI verification; no independent native Windows execution claimed here.

## Authorized correction and local verification

Parent subsequently authorized correcting both test portability findings in `Tests/XLogPrototypeTests/LiveClusterMethodsTests.swift` only. All three native broker fixtures now use `#if os(macOS)`, matching their production dependencies. Their existing Mac assertions are preserved. The always-compiled callback regression uses explicit platform expectations: Mac forwarding stays required; non-Mac forwarding remains unavailable with zero dispatch and output counters. Both branches verify the first-admission cleanup cutoff survives a second changed publication, and cleanup completion is explicitly required after polling.

`AGENT-CLUSTER-FINAL` ran `env XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/phase5-20261029/portable-final --jobs 2 --no-parallel --filter LiveClusterMethodsTests` through the durable runner. Actual result JSON: exitCode `0`, timedOut `false`, durationSeconds `20.354`, source HEAD `0a7e74ab3988537176551aea4a40ed48a012d7af` with the test edit present. Log: all 26 tests passed, including all three Mac broker fixtures and the corrected callback test; test duration 2.309 seconds. `git diff --check` passed. No commit/push performed. Root owns real Linux/Windows CI execution of the portable-specific case.
