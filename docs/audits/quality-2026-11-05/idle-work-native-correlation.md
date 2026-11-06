# Bounded development idle comparison

The guarded idle notification change reduced React work in the focused hook diagnostic and the observed native development renderer. This comparison did **not demonstrate a native CPU benefit**: host and worker CPU were slightly higher in the after interval. It does not qualify a release CPU budget.

The [numeric report](idle-work-native-correlation.json) contains both complete numeric command, timer, Tauri listener, observer and React counter sets, four public process-counter samples, source hashes, boundary context and final stored-QSO checks. It omits observer secrets, private paths, process IDs and fixture markers. Its SHA256 is `6ac25df89c0aed10b3214de5b8db1e44000e3407402d7ff83d66fd9a33cfc3f8`.

The same development host and worker came from application source `16c1b6f8a6959c6eea5940605a754e1122dbd997`. Checkout `795f77c2a48302fda632b6e7434f9e511423fb55` differed only by the reviewed four documentation and six QA paths, with full source diff SHA256 `6c1001a533864c9a070be5a10b6dae879e19e005d834a3cfa41a98454d6753a4`; compiled inputs were checked independently. The before renderer used the archived `spotActivationClient` module from source `230a65047c298881a5e0ae601518af617bce6b8a`, SHA256 `761b6410920a1ce95be90c9e7013ca226b210a7da0c16ea93fee76f45621a818`; the after module SHA256 was `69df75beb5db3e47a3aae1f839e6ff9dbecf88207867dbf64e54e3635ebada3a`. Other renderer sources remained checked and identical. This was a proper development `.app` fixture with React/Vite instrumentation, not a signed packaged candidate.

| Artifact | SHA256 |
|---|---|
| Development host | `3ec30e14710c02e434c1d9767b80a5ddf32bd3c7bf690db9daf111628fb3cddb` |
| Development worker | `d8aa0ac2b007e93d7342c3bd35a9a7fb7b2b5ba017428b42787622996d92632f` |

Each sequential arm used a separate disposable generated 100,000-QSO workspace, normal logging, blank Desk callsign, disarmed CW, disabled operator-draft Follow (the band-map Follow radio checkbox remained checked) and no external station I/O. The root verified exact host/worker executables and complete private-root arguments before native UI observations. Both frontend boundary snapshots reported visible/focused Operator Desk with no dialog and idle activation; no focus or visibility changes were observed by the frontend. These counters do not independently prove continuous OS foreground ownership. The root reported the VM paused during both intervals. No profiler ran during either interval.

| Public process counter | Before | After |
|---|---:|---:|
| Host actual interval, seconds | 120.085662 | 119.936271 |
| Host CPU, percent of one core | 1.439770137 | 1.501382175 |
| Worker CPU, percent of one core | 0.111580417 | 0.119275290 |
| Host resident bytes, start → end | 96,911,360 → 79,347,712 | 115,376,128 → 79,347,712 |
| Host physical footprint bytes, start → end | 55,887,072 → 55,772,384 | 55,592,208 → 55,657,744 |
| Worker resident bytes, start → end | 58,720,256 → 22,921,216 | 23,314,432 → 22,429,696 |
| Worker physical footprint bytes, start → end | 83,657,424 → 79,905,488 | 79,921,872 → 79,921,872 |
| Host package idle wakeups, delta | 174 | 175 |
| Host interrupt wakeups, delta | 8,561 | 8,383 |

CPU comes from public process rusage user/system deltas divided by each process's actual Mach interval, using timebase 125/3. Resident memory and physical footprint are separate process measurements. Shared helpers were not attributed or summed. Page-in deltas were zero for both processes in both intervals; zero does not establish that no other activity occurred. Frontend counters covered 120,002 and 120,001 ms. Native capture windows differed from frontend boundaries by recorded subsecond skew; no exact simultaneity is claimed.

| Frontend counter during the interval | Before | After |
|---|---:|---:|
| Spot snapshot IPC dispatch / completed | 240 / 240 | 240 / 240 |
| CW request dispatch / completed | 158 / 158 | 158 / 158 |
| Follow snapshot dispatch / completed | 80 / 80 | 80 / 80 |
| Operating module status dispatch / completed | 199 / 199 | 200 / 200 |
| Worker request dispatch / completed / failed | 199 / 80 / 119 | 200 / 80 / 120 |
| Automatic rotor snapshot dispatch / failed | 80 / 80 | 80 / 80 |
| Spot hook timer fires / active timers at end | 160 / 2 | 160 / 2 |
| CW timer fires / active timers at end | 158 / 1 | 158 / 1 |
| Follow timer fires / active timers at end | 80 / 1 | 80 / 1 |
| Spot Tauri event listeners active / wakes | 3 / 0 | 3 / 0 |
| Follow Tauri event listeners active / wakes | 1 / 0 | 1 / 0 |
| Rotor Tauri event listeners active / wakes | 1 / 0 | 1 / 0 |
| React commits | 809 | 646 |
| React actual duration, ms | 1,725 | 1,489 |
| Observer calls / measured self duration, ms | 5,667 / 26 | 5,510 / 27 |

Spot polling and its native IPC remained unchanged. The product change suppresses a redundant notification for an already validated idle snapshot; it does not remove activation, reconciliation, error reporting or correlated Stop behavior. Native observer receipts do not measure per-session internal notifications or subscribers. The table's listener counts are Tauri event listeners, not session subscriber counts. Command durations measure asynchronous wall time, not CPU. Worker request failures and all automatic rotor snapshot failures occurred within the isolated offline context; they do not qualify connected station behavior.

A separate 30-second real React hook diagnostic supplies the narrower notification/render evidence: both versions dispatched 42 Spot snapshots and retained five timers and five native subscriptions. Subsequent commits in each of the two activation subscribers fell from 20 to zero; CW, Follow and rotor subscriber commits remained 40, 20 and 20. After unmount, timers and further calls were zero. Its retained red run failed two of three tests; the green run passed 27 tests across five files plus TypeScript. Those are hook-only measurements, not native session counters or a native CPU result.

Both completed native arms ended with ordinary Quit through the root's verified UI sequence, then process-only absence checks. The helper issued no app or worker signals. A held worker process handle did not survive the launch command, so actual worker exit codes were not measured. Each stopped workspace passed integrity and retained all 100,000 generated QSOs and ordered stored-QSO hash `c890ab242dca96dd196217168a1f05dcc299b1ba6a2e877149abbddeaea59af2`. Read-only WAL-aware SQLite backup, destination-only diagnostic journal normalization and a closed main-only copy allowed final normal read-only integrity and all-column hashing. Source main/WAL files stayed unchanged during each read. This is logical QSO preservation, not a claim of physical database equality across the app lifetime.

Earlier incomplete attempts remain failures: the raw development fixture could not bind through the required UI tool; the root requested ordinary Quit before the interval ended and the user complied, so no final CPU sample was captured. Its independent stored-data verification passed. The first proper-app collector was terminated by an erroneous one-second controller timeout before the native sample pair; no native CPU pass is claimed. Neither outcome was replaced by the completed pair.

One observation per arm, development build/Vite/React/observer overhead, unclassified timer work and unassigned shared helpers limit interpretation. The observed React reduction supports removal of redundant idle rendering. It does not establish a causal reduction in host CPU, a production idle budget, full memory qualification, connected equipment behavior or release readiness. [Native ADIF Cancel/Close observations](native-adif-controls.md) have separate evidence; the next packaged candidate remains pending.
