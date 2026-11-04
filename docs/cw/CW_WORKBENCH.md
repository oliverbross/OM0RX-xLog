# CW workbench and typed messages

Open the CW workbench below the existing CW controls on the normal Desk, the
detached CW window, or a single-route contest CW panel. The existing Arm and
Stop controls own output. Opening the workbench, choosing a typing mode, editing
preferences and previewing a message send nothing.

Select the default typing mode in Settings → CW macros. The workbench can choose
a mode for its current unsent composition:

* **Character:** committed characters append immediately after explicit Arm and
  Enable live typing.
* **Word:** a space admits the completed word; the incomplete final word stays
  editable until Send / finish.
* **First word live, then words:** characters through the first word boundary
  stream; later words use word mode. A new job resets the first-word boundary.

Live composition currently requires the existing WinKeyer append adapter.
Other supported radio adapters accept staged Send with their existing limits.
Each append has one native job/connection/lease and a monotonic identity. The UI
submits new segments only. A repeated append cannot repeat an accepted prefix;
Stop retires the job before releasing its output. Reconnect, focus/context change,
restart and settings restore never resume a composition.

Paste, imports, IME preedit, replacement edits and tokens remain staged for an
explicit Send. Ordinary callsign entry, nearby suggestions, Tune & load, country
correction and enrichment are separate from this input surface and cannot start
its drain. Clear compose only clears editable text. It does not clear the held
QSO or retract accepted or uncertain output. Use Stop to cancel the output tail.
After a lost acknowledgement, review the marked uncertain append and use Stop;
the application never retries it automatically.

Normal macros and contest/TLF messages use the existing typed sequence format.
`{WPM:18}` selects a temporary section speed; `{WPM:BASE}` restores base speed.
A final restore is supplied if still needed. `{PROSIGN:AR}` sends one typed
two-letter prosign; supported values are AR, AS, BT, SK and KN. Literal punctuation
stays text. Unsupported adapters reject typed operations before output. WinKeyer
pot mode rejects temporary speed sections so two speed controllers cannot compete.
Preferences cannot apply while a native job owns the keyer.

The preview shows substituted portable calls, report/exchange/serial, typed
prosigns and speed sections. Native dispatch compiles against the actual current
draft and settings and fences its connection. Preview consumes no serial. TLF
early-start and corrected-call workflows retain their existing native/Host
admission and original exchange/serial; the workbench does not log a contact or
reserve another serial. Finish or Stop a workbench job before a contest message
or ESM action. Auto CQ, early-start and exact dual lanes keep their existing
owners; the shared workbench is disabled in those conflicting contexts.

Queued, backend accepted, keyer-reported echo and physical RF are different
evidence. The desk labels raw keyer reports as uncorrelated; they cannot complete
a newer job. The native owner retains any uncertain output obligation even if a
window closes. Physical keyer/radio qualification is recorded separately from
software and packaged UI acceptance.
