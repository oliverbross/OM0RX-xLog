# Directed passes and operating guidance

## Directed passes

In Group Chat, select the destination station, Pass or Helper, and the destination
lane. Capture the current Entry values or enter the receive frequency in integer
Hz, mode, and observation UTC. Review the displayed values before Send. The
frequency is a receive suggestion; a split transmit frequency remains unknown.
An old suggestion retains its original observation time even when its sender's
presence becomes fresh again.

Receiving a proposal does not move Entry, tune a radio, log, or allocate a serial.
The recipient has separate actions:

- **Acknowledge** records receipt only.
- **Load** uses the addressed lane's existing Entry owner and requires an empty
  draft. It does not tune.
- **Park current entry and load** uses the existing call-stack parking workflow
  to retain an occupied draft, exchange and serial before explicitly loading
  the proposal. Its versioned raw snapshot keeps restored/inferred exchange
  values distinct from fields actually heard. The Host parks the original draft
  and its unconsumed serial atomically, then gives the incoming caller a separate
  draft/reservation. Returning resumes the original draft, sent report/exchange,
  received fields and frequency/mode. It does not copy an old serial into a new
  draft. Restart/reply recovery uses the same durable operation identity.
  A missing/consumed legacy reservation, changed setup/lane binding, replica or
  active/uncertain output refuses the transition and retains Entry and queue.
  Resume never arms or resumes output. Legacy audit-only snapshots cannot claim
  sent-exchange preservation and must be reconciled explicitly.
- **Review and tune** uses the existing guarded station coordinator. It neither
  loads Entry nor grants transmit ownership. A CAT command accepted by its owner
  remains different from a frequency observed on the radio.
- **Decline** leaves the proposal readable and disables subsequent actions.

Select the addressed lane before acting; the workflow does not substitute the
currently focused radio for another target. A changed draft, workspace, binding
or connection requires a fresh review. The authority records a requested action
before its effect. A lost reply or interrupted action is retained as uncertain,
and the same operation cannot repeat its effect. Deliberate repeats require a
new explicit action. Legacy messages with zero frequency or no mode remain
readable and acknowledgeable, but cannot be loaded or tuned as complete passes.

## Info/time profiles

Choose a rule edition/category in **Operating rules and plan**, then Save.
Opening the view does not adopt a profile or change scoring.

| Profile | Guidance and evidence |
| --- | --- |
| WPX 2026 CW/SSB Single Operator | Existing 36-hour reconstruction and at least 60 consecutive empty logged UTC minutes |
| WPX 2026 CW/SSB Multi-Single | Existing ten band changes per UTC clock hour; out-and-back counts twice |
| CQ WW 2026 CW/SSB Multi-Single | Independent functional Run and Multiplier ten-minute clocks, using logged whole-minute precision |
| WAE 2026 CW/SSB Single Operator, LOW/HIGH | 36 hours; qualifying off-time excludes both QSO and QTC activity |
| WAE 2026 CW/SSB Multi-Single | Main-station ten-minute activity clock including QTC traffic; unobserved CQ activity remains unknown |

For CQ WW and WAE Multi-Single, expand the contact role declarations, assign the
functional role for each listed contact, and Save. A physical radio/lane number
does not imply Run, Main or Multiplier. Each declaration carries its contact's
source digest; editing timing, band or multiplier facts makes that declaration
unknown again. A Multiplier declaration does not prove the contact qualified for
the exception. CQ WW separately reconstructs new-country/zone status from the
ordered log and retains non-multiplier or early contacts as evidence.

A CQ WW contact logged at 14:00:01 or 14:00:58 starts the same 14:00 log-checking
minute, giving a 14:10 change boundary. Receiver tuning does not restart this
clock. Missing attribution is shown as unknown. These are log/declaration
calculations, not measurements of all station transmissions.

WAE uses QTC transfer headers, prepared/submitted output-attempt times and
recorded operator activities as conservative activity evidence. A pending or
cancelled series cannot establish silence. The HHMM inside a QTC item describes
the earlier reported QSO and is never used as the transfer time. Missing/future
metadata is shown as incomplete; recording or output failure does not establish
an off period.

Each output attempt uses its own captured Entry frequency, separate from the
immutable series header. Prepared/submitted/provider outcomes remain visible as
evidence states and never prove RF. Later operator ledger actions capture the
Entry frequency at that action's timestamp and remain declarations. Legacy
attempts without frequency and ledger actions without a captured-frequency basis
retain unknown bands; the series frequency is never silently substituted. Their
known timestamps still conservatively interrupt off-time, but cannot start a
known-band clock. Expand QTC activity evidence to review the basis.

Profiles require the matching contest, saved category, power where applicable,
and exact edition start UTC. Overlays and unlisted categories remain unverified.
The WPX 2027 candidate was checked on 4 November 2026: the official current rules
still identify 2026 and the named 2027 PDF returned HTTP 404. No 2026 constants
have been relabelled as 2027.

All guidance is advisory. It does not block emergency Stop, certify overall
compliance, rescore a log, or prove RF activity. Source snapshots and the clause
audit are in [the source reference](tlf-2026-sources/source-reference.json).
