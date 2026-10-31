# Window read performance review — 2026-11-01

This frontend review was performed in the canonical checkout based on `6e0cdb62`, alongside the separate SQL and onboarding reviews. It does not record an installed application acceptance.

## Changes

- Main-window hot reads share a cache scoped by workspace generation, saved-settings revision and the logbook refresh epoch. The cache accepts only default catalogue reads, retained Chaser snapshots and five exact, unfiltered 20-contact frames. It retains at most 100 contacts; search results and later pages remain direct reads.
- Only the first 20 contacts are prewarmed. Logbook displays that first chunk while additional bounded frames arrive. Subsequent visits join pending frames or reuse completed frames. Smaller measured viewports can slice an already available frame.
- Optional warming starts after two paint frames and idle time, with at most one three-read batch per minute per workspace. A new logbook revision replaces queued work. Visible reads do not wait for this background budget. Fresh/incomplete onboarding, hidden documents, pending workspace initialization and separate-window presentation do not start main-window optional warming.
- Import requests invalidate the local cache before dispatch and again after either acknowledgement or error. Save, edit, delete, undo and external changes use the existing revision wake to replace the entire scoped cache.
- Chaser, Spot History status, weather and HF public-feed timers pause while hidden. Existing rendered data remains available. Chaser's detached renderer now shares admitted snapshot/feed work within its lifecycle and invalidates on logbook wakes/focus.
- HF Propagation Live resets its mounted flag when an effect starts, allowing asynchronous results after React StrictMode's development effect replay. Packaged production does not perform that replay.

No generic worker-response cache, radio/rotor/control cache, background whole-log materialization or write/unsaved-work change was added.

## External writes and freshness

SQLite QSO insert/update/delete triggers own `currentRevision()`, including a same-count raw external `record_json` update. `LiveServiceMethods.swift` includes that revision in `sync_summary` before its local-mode branch. The existing sequential native `SyncCompletionMonitor` reads this summary every five seconds; `LogbookRevisionObserver` compares the revision independently of contact count and emits `xlog:logbook-changed`. `connectLogbookChanges` coalesces that wake for 120 ms, increments the renderer refresh epoch, and retires cached results and pending promises together. Focus is a recovery read too.

Five seconds plus the debounce is the normal observation cadence, not a deadline during worker failure, contention or event-delivery failure. No new per-window revision poller was introduced. Tests cover same-count row replacement after the canonical wake, settings/workspace changes, uncertain imports, filtered/direct reads and retired pending results.

## Evidence

- `frontend-module-and-cache-timings.json`: native-registry match for all 27 normal windows and 19 contest windows; actual imports of 26 normal React surfaces, 19 contest routes and 13 additional contest dialogs. HM Control's separate HTML entry is checked for presence. These are first/repeat module imports in one process, with shared dependencies, and no mounted component or native data read. All routes loaded successfully.
- `frontend-browser-timings.json`: real React components in isolated Chromium with explicit 200 ms memory-only reads and fail-closed native IPC. First valid data, the following two-rAF observation, and underlying transport calls are recorded separately. Native IPC attempts and page horizontal overflow were zero.
- `setup-1280.png`, `about-440.png`, `chaser-warm-1280.png`: inspected browser screenshots using product components. Setup starts with blank station identity, and About fits its 440 × 530 window.

The recorded synthetic browser run showed first-data cold/warm times of approximately 299/68 ms for Logbook, 220/12 ms for Awards and 207/6 ms for Chaser. The initial warm Logbook visit demanded its remaining four frames because only the first frame had been prewarmed. After those frames settled, navigating away and back took approximately 63 ms to first data and issued zero additional transport reads. Timings are fixture observations, not production SQL or native window-launch promises. Browser development StrictMode performs extra effect work; reported underlying calls are not packaged-production call counts.

Focused validation passed: the initial eight-file behavior batch (135 tests), the supplemental lifecycle/invalidation/working-state batch (35 tests), the route/import batch, and the final scoped-cache tests (17 tests). These batches overlap and must not be added as a unique total. `git diff --check` passed. A separate TypeScript run reached its 120-second tool timeout without diagnostics; the release owner's final typecheck remains required.

## Remaining native acceptance

The release owner must still measure cold WebView launch and warm native show through first valid data for every registered window, including HM Control, Settings, canonical draft/editor windows, retained station/map observations, contest windows and setup dialogs. Live provider freshness, hardware actions and production log mutation were outside this synthetic review. The complete per-window data-origin policy is in `prototype/tests/window-read-inventory.ts` and the JSON inventory.
