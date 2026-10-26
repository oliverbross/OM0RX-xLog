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

Native admission grants the six receive-only decoder methods only to main and
CW Decode. It grants no transmit, tune, QSO mutation, secret or general cluster
authority. Decoder timeout policy retains the logging/radio worker. The main
and Window-menu routes reuse the existing singleton window machinery.

Verification: five component lifecycle/control tests, two bounded projection
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

Still outstanding: native Flex acquisition/resource selection, qualified RF
and quality evidence, measured SNR/WPM, explicit Tune/Use callsign integration,
signed offline packaging, external-client acceptance and the required soaks.
This development UI does not claim the complete feature has shipped.
