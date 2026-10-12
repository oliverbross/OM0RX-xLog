# Windows handoff — integrated xLog acceptance, 2026-10-12

The operator authorized Windows Codex to inspect and restore the existing Remote
Station Agent and HTTPS proxy while preserving station settings and keeping MOX
off. This is service recovery, not an instruction to install the Mac repository
on Windows or replace the deployed agent with an older branch.

## Mac observations

- Initially the agent HTTPS endpoint returned HTTP 502 and standalone xCat was
  reconnecting with its WebSocket disconnected.
- A later unauthenticated GET of `/api/v1/state` returned HTTP 401 (the expected
  authentication challenge). The Mac did not retrieve or print a bearer token.
- Standalone xCat then showed **Agent connected**, but both VFOs inactive,
  KPA/KAT disconnected, route unknown, and five alarms. Its advisory included
  stale/unknown FLEX state, SmartSDR station unbound, `recovery_required`, and
  startup unable to confirm FLEX receive and KPA500 standby.
- Therefore HTTPS reachability has recovered, but hardware readiness is **not**
  established. No Mac command attempted to clear recovery or change the station.
- Shared xLog remains a separate app and isolated copy of the logbook. Its cluster
  testing uses the operator-approved OM0RX-13 session; leave OM0RX-12 untouched.

## Requested Windows actions

**Update after the operator restarted the agent:** the existing Mac xCat now
shows Connected, VFO A 18.160 MHz USB, VFO B 18.088 MHz CW, KPA STBY,
KAT ANT1 on 17 m and clear alarms. The previous hardware-disconnected snapshot
above is historical, not the current Mac display. Do not restart again merely
because this document contains the earlier failure. Continuous Windows-side
freshness/route/MOX evidence still needs the normal read-only acceptance below.
The remaining Mac companion socket reset is a separate local issue, not evidence
that the HTTPS proxy is still failing.

1. Read the current Windows checkout's AGENTS and handoff documents. Record the
   actual running executable/source SHA and branch; preserve all local work.
   Do not reset, merge, downgrade, or deploy an old SHA just to match this note.
2. Inspect the agent/tray scheduled tasks, local listener and Tailscale HTTPS
   proxy/backend. Do not print credentials, environment secrets or token-bearing
   requests. Do not change ports, firewall rules, Tailscale settings or policy.
3. Check FLEX LAN reachability and the existing Maestro binding. Inspect whether
   KPA/KAT serial handles are available through the existing COM17/COM15 VSPE
   arrangement; report conflicts without reassigning ports or terminating other
   station applications blindly.
4. Restore the existing service if necessary, using its established documented
   startup/restart procedure. Preserve `agent.json` and verify its before/after
   hash without publishing its contents. If recovery requires a hardware action,
   policy change, commissioning change, software deployment or new credentials,
   stop and request that specific operator action.
5. Perform read-only authenticated HTTPS and WebSocket acceptance across at least
   90 seconds. Report radio known/fresh, Maestro binding, RX/TX antenna readback,
   route alignment, alarm severity/count, KPA/KAT connectivity and faults.
   Confirm MOX off and KPA standby/0 W from fresh evidence; if these cannot be
   confirmed, state that explicitly. Do not send PTT, TUNE, CWX, OPERATE,
   frequency/mode/antenna/power writes or transmit RF.
6. Return the exact deployed SHA, service status, configuration hash comparison,
   sanitized acceptance counts and any remaining operator action. Do not mark
   recovery successful solely because HTTPS returns 200.

Mac source/evidence is on `codex/unified-xlog-integration-p2` in
`oliverbross/OM0RX-xLog`. No Windows agent source has been changed by this stage.
