# Q05: bounded POTA chunk conversion

Source baseline: `da6fefb394944b28be9533ab861be9026306fa8d`. Status: **fixed in source**, native packaged acceptance **not run**. This is export allocation churn, not an attribution of the reported idle memory incident.

`pota_read` rebuilt a whole prepared file's UTF-8 `Data` for every response of at most 12,000 bytes. It now borrows the immutable text's contiguous UTF-8 buffer with `withUTF8` and constructs only the requested byte slice. The snapshot/token/generation/expiry checks, byte offset validation, output size limit, base64 envelope and retained preview lifetime are unchanged. No second whole-file byte cache or new retention owner is introduced.

The checked-in [standalone benchmark](runtime-pota-benchmark.swift) uses a 6,750,000-byte synthetic Unicode fixture and reconstructs all bytes from 563 base64 chunks. Instrumented Data construction bytes fell from **3,807,000,000 to 6,750,000** (564-fold). Three compiled `swiftc -O` runs had median elapsed time **0.21175 s before / 0.00889 s after**. Peak RSS remained approximately **27.9 MB** in both cases. These observations support reducing copy churn; they do not establish a peak or retained-memory improvement. The benchmark includes common base64 and full-output reconstruction. Other quality builds were active, so timings are indicative, not a performance budget.

Reproduce on macOS:

```sh
swiftc -O docs/audits/quality-2026-11-05/runtime-pota-benchmark.swift -o /tmp/xlog-runtime-pota-benchmark
/tmp/xlog-runtime-pota-benchmark before
/tmp/xlog-runtime-pota-benchmark after
```

The expanded `QLogQueryWorkflowTests.pagedPOTAPreviewUsesFrozenTwoByThreeAndPreservesSource` exercises the real `LiveLogbookMethods` action with two own parks, three contacted parks and non-ASCII metadata spanning several chunks. It compares the complete wire reconstruction with independently prepared frozen export bytes, checks continuation-byte offsets, final short/empty chunks, invalid offsets, and unchanged stored contact evidence. `XLOG_PORTABLE_ONLY=1 swift test --scratch-path .build/prototype-tests --enable-swift-testing --filter QLogQueryWorkflowTests` — **3 tests passed**, including the expanded POTA test (0.120 s; suite 0.213 s). An initial command without portable mode built the default source slice and reported no matching tests; it is not counted as acceptance.

Environment, samples and metric definitions: [runtime-pota-chunks.json](runtime-pota-chunks.json). Release-source hashes/commit are recorded by the integration owner; this bounded work did not package, install or bump a version.
