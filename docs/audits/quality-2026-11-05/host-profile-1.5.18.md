# Saved host profile: bounded attribution lead

The saved trace supports a desktop/runtime IPC investigation. It does not attribute the preceding ten-minute CPU result to a feature, JavaScript execution, a leak or application shutdown.

Candidate source: `0b7c669663841c2e55569b0c21c76ad03805cad7`.
Signed host SHA-256: `4f95f35d234919d7bf81d5cba50f0f33041056a927bf362978c35d7a3bae8ffa`.
Signed worker SHA-256: `31ac2cdda0254df08b57058a07b29ceae1f83acd365debdcdb13f15eea639f67`.
Only the saved host trace was analyzed; the worker was not profiled.

There are 126 Running samples, each with 1,000,000 ns statistical weight. Their 126,000,000 ns aggregate is **not measured CPU duration**. Samples span trace-relative 0.342305–11.224306 seconds; TOC duration is 11.287902 seconds despite the requested ten-second recording limit. This profiler-on interval is separate from the completed unprofiled CPU counter interval.

| Observed thread/category | Samples / 126 | Interpretation |
|---|---:|---|
| Main thread | 56 / 44.44% | Includes native run loop and request/response handling. |
| JavaScriptCore libpas scavenger | 34 / 26.98% | Native allocator maintenance; 22 leaf samples are `pas_thread_local_cache_for_all`. |
| Two Tokio runtime threads | 12 / 9.52% | Includes Tauri invoke handling and response serialization. |
| Seven distinct sampled CVDisplayLink threads | 8 / 6.35% | Includes waits and three thread teardown stacks. Sampling alone does not count all thread creations. |
| WebKit IPC, inclusive | 46 / 36.51% | Includes URL-scheme task decoding, dispatch, request/header conversion and IPC queue processing. |
| Tauri IPC, inclusive | 19 / 15.08% | Includes invoke protocol and response paths. Overlaps WebKit IPC; do not sum these categories. |

The JavaScriptCore **leaf-image** share is 37/126 (29.37%); this differs from the scavenger-thread count and does not mean JavaScript application code consumed that share of CPU. The application-binary leaf share is 10/126 (7.94%); app-owned work can also execute in system/framework images.

Sample counts in consecutive trace-relative one-second buckets are 2, 13, 9, 11, 16, 9, 12, 17, 10, 7, 12 and 8. Scavenger samples occur throughout: 31 before ten seconds and three afterward. WebKit IPC has 37 before ten seconds and nine afterward; Tauri IPC has 18 and one. This distribution is not a concentrated final shutdown burst. Counts are sparse statistical observations, not request rates, duty cycles or percentiles.

All three sampled exit/terminate paths are **CVDisplayLink pthread teardown**, at 2.455305, 3.455306 and 10.488307 seconds. They are not sampled application termination. No application Quit/termination stack appears. TOC separately records attached-target `exit(0)` and recording end reason `Time limit reached`; the saved samples do not identify the initiating actor/cause or a usable steady-idle/shutdown boundary. This sequence cannot claim normal Quit, uninterrupted steady GUI state or profiler causality.

Two Tokio samples contain `runtime_profile::connected_loopback` and `allows_worker_method`, including file reads. Quantify this private-profile guard overhead separately; the trace does not establish its production cost and does not justify weakening isolation checks.

Next owner: desktop/runtime. Correlate redacted per-command dispatch/completion counters and timer/subscriber ownership with native host and positively attributed renderer sampling in a new disposable run with explicit isolation proof. Repeated WKWebView/Tauri transport work is a defensible lead; command names and feature callers are absent here. Scavenging may be downstream of allocations but this trace does not prove that chain. Preserve lease/Stop supervision.

The [sanitized aggregate JSON](host-profile-1.5.18.json) retains all five raw-input hashes and the thread/category/time-bucket counts. Detailed relative-sample analysis and raw trace XML remain private. This saved host-only analysis performed no live process probes, app bindings, tests or rebuilds. The [preceding ten-minute counter interval](desktop-steady-ten-1.5.18.md) is a separate measurement.
