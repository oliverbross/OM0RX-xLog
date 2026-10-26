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

The isolated follow-up branch adds Call, native signal estimates with expiry,
requested/actual rate and usable-width status, fresh worker load counts,
committed-only Copy, source evidence details, native track Mute and explicit
Normal Logging Use callsign. See [selection/action boundaries](TRACK_SELECTION.md)
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
evidence, hardware signal calibration, explicit Tune,
complete process-restart action recovery, full CW package acceptance,
external-client acceptance, measured capacity and the required soaks.
This development UI does not claim the complete feature has shipped.
