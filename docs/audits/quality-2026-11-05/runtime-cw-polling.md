# Q04: shared CW observation dispatches

Source baseline: `da6fefb394944b28be9533ab861be9026306fa8d`. Status: **fixed in source**, native packaged acceptance **not run**. Installed 1.5.15, station state and production storage were untouched.

The real hook produced 41 snapshot calls in 30 seconds from a visible disarmed desk (including its initial read), and another 40 while hidden. Hidden disarm did not retire the 750 ms interval. A suspended desk skipped IPC but retained its interval.

`useSharedCW` now cancels hidden/suspended observation timers and refreshes immediately on focus/resume. It keeps the existing 750 ms visible cadence and the same cadence whenever this renderer owns a native lease, including the hidden Setup controller for a detached Entry. The cadence is below native's three-second heartbeat expiry. Lease identity, rather than the rendered `armed` flag, keeps supervision running through an uncertain response. Native Stop, unregister, expiry and focus fencing are unchanged.

| State, 30 seconds | Before snapshot calls | After snapshot calls |
|---|---:|---:|
| Visible disarmed, initial read included | 41 | 41 |
| Hidden disarmed | 40 | 0 |
| Suspended | 0 | 0 |
| Active lease holder | 40 | 40 |
| Hidden native Entry lease holder | 40 | 40 |
| After unmount | 0 | 0 |

The regression asserts zero outstanding timers for hidden disarmed, suspended and unmounted states, prompt resume refresh, and no timer revival after an in-flight snapshot finishes following unmount. These are deterministic React/jsdom tests with a fake clock and native IPC stub; counts establish dispatch behavior, not native CPU, physical footprint or RF behavior. A fully event-driven visible disarmed observer is a separate change requiring complete canonical update notifications. A five-second visible cadence was evaluated, then excluded because Arm relies on the last observed revision and native revalidates canonical context; increasing staleness can reject the operator's first Arm after a change.

Independent review of `5fac0a06` found that context-change unregister replies reset the pending timeout. A new regression reproduced starvation: ten context changes spaced 500 ms apart yielded only the initial snapshot over five seconds. The follow-up keeps an existing deadline while observation remains eligible, rather than rescheduling on every session emission. The same scenario now produces seven snapshots at five seconds and eight at 5.25 seconds. An explicit Arm then uses the fresh canonical revision 10; the context updates themselves never Arm. Hidden/suspended retirement and in-flight shutdown checks still pass.

Verification: `npm run test:vitest -- src/live/useSharedCW.polling.test.tsx src/live/useSharedCW.test.tsx src/live/sharedCWSession.test.ts src/live/CWComposition.test.tsx src/live/cwMessagePlan.test.ts` — **21 passed** in five files. `npx tsc --noEmit` — **pass**. Machine-readable counters: [runtime-cw-polling.json](runtime-cw-polling.json).
