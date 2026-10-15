# Windows Agent drive rollback source fix — 15 October 2026

## Outcome

The Windows Remote Station Agent source now treats amplifier transitions as
complete drive transactions instead of changing only the KPA state.

- Explicit Standby first confirms KPA500 standby, then restores and verifies the
  configured barefoot FLEX drive for the current route. The emergency Standby
  path remains available when the station is uncommissioned or the radio route
  is unknown.
- Operate captures a fresh authoritative FLEX drive immediately before applying
  amplifier drive. If any later interlock, KAT or KPA proof fails, the Agent
  confirms KPA standby and restores that exact pre-Operate drive before releasing
  the serialized station/radio transaction.
- Cancellation performs the same rollback.
- If either KPA standby or FLEX drive restoration cannot be proved, the Agent
  records and returns `operate-rollback-incomplete` with the underlying rollback
  detail. It no longer reports only the initiating failure while silently
  retaining amplifier drive.

## Source and verification

- Repository: `/Users/oliver/Documents/Projects/om0rx-radio-control`
- Branch: `codex/latency-route-polling`
- Commit: `67d2902` (`Restore FLEX drive after amplifier transitions`)
- Focused station/Agent/policy run: **131 passed**.
- Complete station-coordinator file: **83 passed**.
- Complete smoke run reached **912 passed, 7 skipped**. Five unrelated tests and
  two setup cases remain environment/baseline failures: unavailable .NET probe
  dependencies, local Wavelog database authentication, generated fixture/icon
  state and existing frontend/FT8 fixture expectations. None is in the changed
  station transaction path.
- Python compile checks and `git diff --check`: passed.
- No Agent process was started and no radio, amplifier, tuner, rotor, PTT, Tune,
  CW or RF action was issued.

## Acceptance boundary

This closes the source defect and binds the requested 90 W-style Standby case,
failed-Operate rollback, cancelled-Operate rollback and rollback-failure
reporting in tests. Windows installation and physical KPA/KAT/FLEX readback
acceptance remain open until the operator turns the Agent back on.
