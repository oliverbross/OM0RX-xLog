# Retained CW track selection

This milestone adds a passive native evidence resolver. It does not add a Tune
or Use-callsign button, mutate a draft, grant radio authority, or qualify CW.
Those actions still need their separate existing-owner integration.

A track gets an opaque selection reference only when committed aligned text
identifies one plausible transmitting callsign in the last sixty channel seconds.
Provisional text and competing identities do not qualify. Ambiguous/replay tracks
have no reference. The reference pins session, source, stream token, epoch, track,
revision and a generated selection UUID. A different call, qualified frequency,
revision or capture retires the previous reference. Equal evidence keeps its
reference across passive snapshots. Native track UUID case is preserved safely.

`CWDecodeSession.resolveSelection` reads the retained track and existing provider,
then rechecks the actor after the asynchronous provider read. Stop, changed lease,
source, epoch or selection fail closed. Input must be at most 250 ms old and the
selection must have been renewed by a decode within two seconds. Callsign-only
resolution may work with unqualified RF; it returns no invented frequency.
Requesting an RF target additionally requires qualified mapping and a real
in-passband frequency. The resolver has no side effects.

The frontend projection validates callsign shape and every reference field
against the same track/capture. Renderer-supplied fields cannot become a native
callsign or frequency; future action admission must resolve the retained native
reference again at its owning draft/control boundary.

Validation: eleven focused session tests passed, including unqualified RF
refusal, invented selection, stale input, changed provider, ambiguity and Stop
during a suspended read. Four projection cases and production TypeScript passed.
The existing automatic-spot production quality refusal remains tested and intact.

Remaining integration: callsign-only normal-draft semantics through the shared
editor/CAS/receipt owner; fenced contest `entry_set_text` through its sole main
consumer; explicit Tune through the durable manual-tune owner with current source
and operating-radio admission; scoped window methods, UI and action recovery tests.
