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

Live literal composition is supported by WinKeyer and the native macOS direct
Flex LAN adapter when its CWX subscription, connection handle and indexed block
replies provide attributable progress. Flex shows **Radio reported** characters
separately from **Backend accepted** text. Duplicate/foreign-client/old-connection
events cannot advance that report. Unknown handles, malformed replies, erased or
reused index ranges disable live typing; use Stop, review the text and use staged
Send. Reconnect never resumes a tail. A Flex append is at most 128 literal
characters, with at most 2,048 characters in one job. Finish closes the job; Stop
releases its retained output guard before starting another live job.
Using the retained unindexed whole-message Flex Send, or stopping before an
indexed append reply arrives, requires reconnect before live typing: late status
from that unindexed/uncertain output cannot safely qualify a new live job.

Typed speed/prosign segments still require WinKeyer. Buffered Flex speed changes
are outside this milestone. Flex through the Remote Station Agent remains a
whole-message route. Physical FLEX-8400 qualification remains **NOT_RUN**.
TCI supports whole literal staged messages only, up to 128 characters, with
ExpertSDR3/TCI 2.1 and exactly one advertised TRX; it has no live append or typed
segment support.
Other supported radio adapters accept staged Send with their existing limits.
After a staged message finishes, another explicit message can use the same armed
radio route after fresh admission. A new message cannot take over an open live
job, a busy keyer or a changed output connection.
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
draft and settings and fences its connection. Preview consumes no serial.
Contest report and serial tokens follow the selected cut-number and padding
preferences in both preview and output; the underlying draft retains its raw
report, exchange and serial. Literal typed text is unchanged by those preferences.
TLF early-start and corrected-call workflows retain their existing native/Host
admission and original exchange/serial; the workbench does not log a contact or
reserve another serial. Finish or Stop a workbench job before a contest message
or ESM action. Auto CQ, early-start and exact dual lanes keep their existing
owners; the shared workbench is disabled in those conflicting contexts.

Queued, backend accepted, radio-reported characters, keyer-reported echo and physical RF are different
evidence. The desk labels raw keyer reports as uncorrelated; they cannot complete
a newer job. The native owner retains any uncertain output obligation even if a
window closes. Physical keyer/radio qualification is recorded separately from
software and packaged UI acceptance.

In the Traditional desk, the Active QSO card scrolls when its CW workbench or
voice library is expanded. Scroll inside that card to reach Send/Stop or the
contact fields; closing a panel returns the compact view without clearing text.
