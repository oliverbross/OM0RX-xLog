# Callsign Checking recovery — 25 October 2026

The operator reported Main Logging remaining on “Checking” for VP2MAA on
installed 1.3.16. Read-only UI inspection also observed a later locally typed
J75A still showing Checking. The operator restarted xLog and confirmed recovery.
No IPC trace establishes that lost wakes were the sole cause of that incident.

Two recovery gaps were reproduced in isolated tests before the fix:

- A native action queued after the owner's initial drain was never consumed if
  its wake event was lost. The owner now checks its durable queue once per second
  while idle, using the existing serialized native admission path.
- An action completing after waiter registration could lose both projection and
  completion wakes. A detached window now refreshes its snapshot every 500 ms
  only while that receipt is pending. The terminal result, existing 20-second
  timeout or unmount ends polling. The action is never resubmitted.

The original two tests failed without these changes. All 202 detached entry and
owner tests, TypeScript and whitespace checks passed on an isolated source
snapshot containing only the staged recovery changes. Independent review found
no blocking race, action replay or timer-lifecycle issue. Initial tests against
the working tree encountered unrelated recorder UI changes and an incorrect test
working directory; the complete clean-source rerun passed.

The concurrently edited recorder implementation was preserved and excluded from
this commit and its clean-source tests. No package or installation was performed;
the current installed source remains 1.3.16 at
`ec981e72a896ddb0a26e48f43ecd6822f9d7bf9d`. This recovery belongs in the next reviewed,
uniquely versioned candidate. No production QSO, draft, radio, PTT, audio or rotor
operation was performed for testing.
