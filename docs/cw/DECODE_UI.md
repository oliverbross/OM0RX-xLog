# CW Decode views

CW Decode has an ordinary main-workspace route and a lazy singleton native
window, exposed separately from the existing CW transmit window. Both read and
control the same `LiveCWDecodeMethods` owner. The native request route uses only
the current worker generation; opening a view cannot replace a missing worker,
acquire IQ, start a listener or stop another view's capture.

The panel shows source/centre/rate state, frequency-ordered tracks, committed
text, the provisional tail and a selected-signal inspector. Unqualified RF
mapping is shown as an offset rather than an authoritative frequency. WPM and
SNR remain unavailable until measured; model inference time is labelled as such.
Source settings use revision-bound saves and remain local until Save. Changes
from another window cannot silently overwrite the edit base. Start and Stop
are explicit, and Stop remains available while Start is pending.

The listener has separate Start/Stop controls and truthful off/starting/listening/
occupied/failed/self-loop states. Endpoint settings can be changed while IQ
continues when the listener is stopped. Unknown or stale worker reads clear the
live projection; old reads or Start replies cannot overwrite a newer Stop.

Native worker admission grants only the receive-only decoder namespace to main
and CW Decode surfaces. It grants no transmit, tune, QSO mutation, secret or general cluster
authority. A separate identity-only native command owns explicit callsign loading
through the Normal Logging editor/CAS/receipt coordinator or the sole contest
Entry consumer. Decoder timeout policy retains the logging/radio worker. The main
and Window-menu routes reuse the existing singleton window machinery.

Original UI milestone verification: five component lifecycle/control tests, two bounded projection
tests, direct lazy-window loading and twelve existing navigation tests pass.
Two native role/timeout tests and 135 native workspace-related tests pass. The
production bundle graph excludes the main controller, maps and CW transmitter
from CW Decode startup; the measured CW Decode graph is 285,404 bytes. Its lazy
route adds bounded bootstrap metadata to other windows; Logbook is 403,513
bytes and contains no decoder panel. Existing unrelated graph caps remain.

Visual inspection used labelled synthetic data, without a native bridge, model,
listener or station connection, at 1360×900 and the 640-point minimum width.
The incumbent navy/system-font console is preserved. The same input/copy styles
and readable labels are used at both sizes; the dense table scrolls within its
own region. These are renderer checks, not installed-app or RF acceptance.

The isolated follow-up branch adds Call and Opportunity, native signal estimates with expiry,
requested/actual rate and usable-width status, fresh worker load counts,
committed-only Copy, source evidence details, native track Mute and explicit
Use callsign in both logging modules and separate explicit Tune. See [selection/action boundaries](TRACK_SELECTION.md)
and [signal/load evidence](SIGNAL_DIAGNOSTICS.md).

The contest Window menu also opens the singleton `contest--cw-decode` using the
existing context-bound native window owner. It loads the same lazy receive view
and service. Every decoder request verifies its native URL has exactly one
view/scope/operating-context/session/workspace tuple, then admits that tuple
against current native contest authority. Renderer fields do not establish it.
The window has no contest mutation, normal-draft, secret or station-control
authority. Opening/closing it neither starts nor stops capture. Callsign loading
uses the separate, fenced native action described in the selection document;
the decoder window never acquires raw contest mutation authority.
Validation: 137 native workspace cases and the receive-only role case pass;
thirteen navigation/lazy-loader cases and six selected contest startup/menu cases
pass, including the CW menu intent after session restoration. TypeScript passes.
No installed contest-window or live CW acceptance is claimed.

Still outstanding: real Flex/SunSDR input qualification, qualified RF and quality
evidence, hardware signal calibration, installed Tune acceptance,
complete process-restart action recovery, full CW package acceptance,
external-client acceptance, measured capacity and the required soaks.
This development UI does not claim the complete feature has shipped.

Opportunity reads the existing cluster contact index for a resolved callsign on
a qualified CW band. Call status and DXCC status remain distinct. This is a
passive annotation: it cannot publish a spot, repair a callsign hypothesis or
change worked/confirmed state. The worker uses only an already loaded current
contact projection; it does not scan the database or connect a cluster when this
view opens. Missing/stale contacts, call-less, ambiguous, muted, replay or
unqualified-frequency rows show Unavailable. It does not claim contest multiplier
or dupe classification. Contact refresh and workspace changes fence late results.

Validation includes index parity for new/worked/confirmed calls, unavailable
contact state, no published spots or opened transports, worker cache lifecycle
and strict renderer projection. This is source/fixture evidence only.
Fourteen Swift cases (13 XCTest and one Swift Testing), 33 focused frontend
cases and TypeScript passed on the Opportunity change.

## Operator guide for the documented launch scope

These controls are implemented; the completion checklist still records the
unclosed hardware, quality, capacity, soak and installed gates. The accepted
installed 1.3.63 does not become a qualified skimmer through this guide.

1. Connect the selected direct Flex or SunSDR/TCI slot in Radio Settings. In
   **Sources & server**, choose one or two existing receiver spans at 96 ksample/s,
   two spans total. Check the actual centre and usable RF coverage. Duplicated
   audio, VFO pitch and requested rate are not evidence of received RF coverage.
2. For Flex, select the exact SmartSDR Station and its existing panadapter with
   assigned DAX IQ channel. Release that channel's competing consumer yourself,
   acknowledge the displayed handoff and use **Allow xLog to acquire DAX IQ**.
   Start within its displayed 30-second validity. Discovery, RX state, ownership
   and fresh samples must still pass; the checkbox cannot override them. TCI uses
   the shared connection and the explicitly selected receiver lease.
3. Use **Start decoding** deliberately. Opening a main, detached or Contest CW
   view and loading saved settings stay passive. All views share capture. Use
   **Stop** to release all capture resources. **Stop span** releases only that
   source; **Start span** deliberately resumes a stopped/corrected source while
   the other keeps receiving. Wait for Stopping to finish and obtain a fresh Flex
   handoff when needed. Closing a view is not Stop.
4. Inspect frequency-ordered signals and the selected track's **Show evidence**.
   Committed text and the changing provisional tail are distinct. WPM/SNR or RF
   shown as unavailable remain unknown. **Copy committed text** copies committed
   text only. **Mute** lasts for that track's lifetime. Read the specific **Spot
   withheld** reason; absence of an accepted spot is not evidence of no signal.
5. **Use callsign** requires two distinct completed self-IDs, fresh qualified RF
   attribution and deliberately targets the displayed Normal Logging or Contest
   Entry owner. Contest shows the intended lane, draft and revision; a changed
   lane/draft/binding is rejected. Open the intended Entry lane and finish or park
   any occupied callsign first. Repeated windows of one transmitted ID do not enable it.
   Diagnostic copy with unknown RF has no callsign-loading or Tune action.
   **Tune** is a separate action through the selected source's current radio
   owner. Selecting a signal performs neither action. Finish occupied/uncertain
   draft work first. If a reply is lost, use **Check original action/tune**. After
   losing a window ID, **Find original action** reads retained callsign operations
   while capture is stopped; choose the exact original if more than one remains.
   Review the current entry after historical confirmation. Missing or malformed
   native evidence requires review, never repeated application or journal deletion.
6. Set the local listener's port in **Sources & server** (default 7300), then use
   **Start server** separately. Configure the external client for plain TCP/Telnet
   `127.0.0.1:<port>` and send its callsign/client name. `sh/dx` requests retained
   history at its original UTC. An occupied port is reported; stop the listener
   before editing its endpoint. **Stop server** leaves capture independent.
   xLog receives typed Local CW directly and must not connect to its own listener.
7. For interruption or stale data, inspect source/stream/epoch, actual coverage,
   pending/in-flight/coalesced/dropped counts and the displayed failure. Stop,
   verify the released resource and offline payload, then explicitly restart.
   Retune, TX/unknown receive state, gaps and reconnect retire stale evidence;
   old copy cannot authorize a fresh action or spot.

**Frequency evidence unavailable** means the self-IDs lack reliable carrier
measurements at their sample times. Fresh measured copy must establish evidence;
the current track frequency cannot substitute for an earlier ID's frequency.

**Continuity interrupted** means a worker revision lost text evidence, including
pending inference coalescing or a dropped derived event. The affected committed
copy and callsign action are cleared. Overlapping old windows cannot restore
them; fresh aligned copy/self-IDs must establish evidence again. A spot already
waiting for classification or listener admission is checked against the current
track's bounded publication proof before and after provider readback. Accepted
historical rows remain history.

**Decode age** measures the decoded window's end behind the newest received IQ,
including FIR delay and elapsed local time. **Carrier age** uses the actual
carrier sample; metadata-only updates cannot renew it. Both stay unavailable
without evidence. These receive-relative measurements do not establish radio/
transport latency, committed-character delay or spot delay. Model time remains
separate. Expired or missing carrier evidence shows **RF unavailable**, withdraws
RF actions and retains only the diagnostic offset. Fresh qualified RF and two
distinct self-IDs are still required for callsign loading.

Source cards retain the actual failure category: unsupported TCI contract,
missing manufacturer discovery, unverified receive state, resource ownership,
expired handoff, rate conflict, invalid IQ, missing data, stall, overflow or
continuity loss. Fix a blocked resource, then explicitly Start that span. A transient
failure shows its bounded retry count. An error on one source leaves the other
source running. The view does not retry acquisition by itself.

Span controls bind the current session and configured source. A late Start reply
cannot overwrite a newer span Stop. A stopped span stays stopped when the shared
child recovers; starting it does not restart the child or listener. With every
span stopped, the header says **Ready · spans stopped**, rather than claiming
fresh reception. Listener controls remain separate.
