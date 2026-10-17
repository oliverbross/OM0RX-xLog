# Operator flow intent contract

This preview defines a pure Run/S&P intent state machine for the four
source-derived CQ WW and CQ WPX CW/SSB pilots. It simulates operator decisions;
it does not key a radio, play audio, render a macro, reserve or commit data, or
own a native transmission lease. Integration must route its intents through the
existing CW/voice and contest mutation owners.

## Source behavior

The behavior was read from `oliverbross/contest-sw` at
`7c8b499225a73f7f8f792246881bd7aefc05452f`. The four `process_esm` functions in
`cq_ww_cw.py`, `cq_wpx_cw.py`, `cq_ww_ssb.py`, and `cq_wpx_ssb.py` are the same:

- Run sends CQ from an empty callsign field, HISCALL then EXCH for a callsign,
  AGN for a missing or nonnumeric exchange, and QRZ then logs a numeric exchange.
  It can resend a corrected HISCALL before QRZ.
- S&P sends MYCALL for a callsign, AGN for a missing or nonnumeric exchange,
  and EXCH then logs a numeric exchange.
- Configured function keys dispatch through CW output in CW modes and the voice
  process in phone modes. Escape maps to the common Stop action and Ctrl+R
  changes Run/S&P style.

The pinned program treats a callsign with more than two characters as usable,
treats only numeric exchange text as complete, and sends/logs sequentially
without durable acknowledgement. It does not provide browser IME/repeat guards
or reserve a serial before expanding the exchange macro.

## xLog reliability normalization

The reducer consumes authoritative `valid`, `invalid`, or `empty` cues from the
future integration instead of reproducing length and numeric heuristics. A
duplicate callsign selects QSOB4. Macro bodies and rendering remain outside the
reducer. WPX sequences containing EXCH cannot start until the contest mutation
owner confirms a serial reservation for the captured context and supplies its
authoritative successor draft snapshot. The successor names the captured draft
as its predecessor, has a new draft identity, and contains the reserved serial.
The confirmation and snapshot may arrive in either order; the reducer waits for
both, then adopts the successor cues and plan identity atomically before it
emits EXCH. An ordinary cue edit cancels the sequence. This handshake does not
replace the mutation owner's final identity check when it admits an intent.

Every cue snapshot has an immutable draft identity which must change whenever
the callsign, exchange, serial, validation, or other commit input changes.
Every reserve, send, and commit intent captures that identity and uses a
caller-issued operation ID and a
strictly increasing admission number. The reducer checks the exact pending ID,
admission, session, workspace generation, context generation, CW/SSB mode, and
serial policy before accepting an outcome. The existing owners remain
responsible for globally unique IDs and durable recovery; the reducer only
retains transient sequencing state and a bounded recent-ID fence.

A confirmed commit, including a confirmation obtained by receipt
reconciliation, consumes the committed draft identity and clears its cues.
Enter emits nothing until integration supplies a distinct authoritative draft
identity for the next contact. The reducer rejects replay of the 128 most recent
consumed identities in the same context. A context change resets that bounded
local fence; the durable mutation owner remains authoritative across restarts,
older identities, and context lifetimes.

Only an explicit Arm event enables Enter or a function key. Repeat, composing,
prevented, modified, unmapped, invalid-cue, and stale-context key events emit no
intent. Escape, Run/S&P changes, and context changes disarm. CW versus SSB is a
fixed context property rather than a Run/S&P style toggle.

A confirmed send advances to the next macro. A commit intent appears only after
every required send is confirmed. A definite failure permits a later explicit
operator action; it never retries automatically. An unknown send keeps its
operation until the existing output owner confirms idle. An unknown serial or
commit keeps its operation for receipt reconciliation. A second Enter while any
operation is owned emits nothing.

After a serial reservation is confirmed, the reducer can wait for its
authoritative successor snapshot without emitting EXCH. An edit, Escape, or
style/context change during that wait terminates the local sequence without a
send or commit; the durable owner keeps the serial allocated and prevents reuse. An
unconfirmed or unknown reservation remains owned until its outcome is known or
reconciled.

If fields or validation change during a pending operation, the refreshed cue
snapshot disarms the flow and cancels the remainder of the frozen sequence. The
original operation stays owned. Its late result may settle that operation, but
cannot authorize a later macro or a commit for either the captured or edited
draft. Integration must check the captured draft identity again when admitting
each intent; the reducer does not make mutable form data immutable by itself.

If style, session, generation, or fixed mode changes during an operation, the
original context and operation remain owned separately from the latest desired
context and style. Further A to B to C changes validate against and replace that
desired target; an old A style event cannot overwrite B or C. A late A result
may settle only the original operation, then activates the latest desired C
context in a disarmed, cue-empty state. It cannot send the rest of the old
sequence, commit the old draft, or start work in the new context.

The reducer copies caller-provided contexts, cues, operation tokens, admissions,
and macro arrays. Returned state, nested values, and emitted intent snapshots
are frozen, and an intent does not share a mutable token or context object with
state. Caller mutation after a transition therefore cannot rewrite captured
ownership or an already emitted command. Integrations must still treat these
values as data and pass them to the existing owners for authoritative checks.

The Test-profile workspace binds this reducer to an explicitly armed simulation
panel for the pinned CQ WW and CQ WPX CW/SSB pilots. The panel uses the shared
CW template expander only to render a visible local trace. It does not call the
native CW session, voice/audio, PTT, radio, or device owners. Reservation and
commit intents use the existing contest mutation client and recovery journal.
A lost mutation acknowledgement remains owned by the normal receipt/exact-retry
controls. Recovery is admitted only when method, session, workspace generation,
request ID, and payload digest match the exact uncertain mutation captured by
the sequence. The operator sequence stays disarmed until that same operation is
reconciled. Before simulated output, reservation, or commit, the integration
also rechecks the captured context and draft against the current mutation owner;
dirty, busy, disabled, edited, or replaced drafts are rejected. Admission is
phase-specific and uses an exact allowlist of the worker's missing callsign,
geography, received-exchange, and sent-serial messages. A worker-shaped blank
draft may call CQ, an incomplete received exchange may request AGN, and WPX Run
may reserve from a valid callsign before the received exchange exists. Output
that leads to commit and commit itself require the authoritative validation and
duplicate checks to be clear; numeric but out-of-range exchanges and callsigns
that fail the worker's letter, number, or slash-shape requirements cannot
progress. Manual draft edits, style changes, session changes, Escape, and
manager switches disarm the simulation. Enter events are consumed only while
the flow is armed or owns an operation, and the form independently refuses
implicit submission over that same interval. Disarmed Enter retains Plain Log
submission.

Oceania DX, SAC preview, and any future rule identity remain on Plain Log until
their operator sequences are separately audited. The simulation trace is not
evidence of RF, audio, macro timing, or transmit completion.

## Boundary

The reducer module supplies no event listener and makes no browser, filesystem,
worker, native, audio, radio, or network call. Its Test-profile integration adds
only scoped keyboard handling, simulation trace rendering, and calls to the
existing contest mutation owner. Voice playback and CW transmission remain out
of scope. These tests establish deterministic intent sequencing and contest
mutation integration only; they are not RF, audio, native-process, or durable
restart evidence.
