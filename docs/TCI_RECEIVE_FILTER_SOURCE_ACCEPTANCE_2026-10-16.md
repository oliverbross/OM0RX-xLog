# Native TCI receive filter source acceptance

The next native TCI slice adds explicit receive-filter adjustment on the existing
saved TCI WebSocket. It is scoped to the saved TRX and shared by its channels;
the protocol has no channel argument for this command.

Normative source: [ExpertSDR3 TCI protocol, pinned b081213ff97150fd29f669c633f060f93c81a286](https://github.com/ExpertSDR3/TCI/blob/b081213ff97150fd29f669c633f060f93c81a286/TCI%20Protocol.pdf),
page 20, RX_FILTER_BAND. The document defines a three-argument setter and reply
(receiver number, lower edge Hz, upper edge Hz), a receiver-only query, and
bidirectional control. The document was inspected locally using Apple PDFKit.

The application requires integer edges from -24000 through 24000 Hz and
lower < upper. This is a conservative application limit, not a claimed device
capability or a limit discovered from IF_LIMITS. IF_LIMITS no longer prunes
RX_FILTER_BAND telemetry because it describes a different protocol quantity.

Admission requires the exact saved selection identity and generation, unused
control revision, existing worker generation, connection generation, fresh READY
state, observed transmit-off, and a previously reported filter. One bounded frame
contains one RX_FILTER_BAND setter followed by one filter query. Success requires
a newer accepted same-TRX filter report matching both edges. READY, unrelated
telemetry, another TRX, invalid reports and retained matching edges cannot confirm
an operation. A final connection/state fence runs before returning confirmation.

The existing native Station Control journal saves pending intent before dispatch,
deduplicates an operation across restart and keeps unknown outcomes unresolved
until the operator explicitly reviews them. The renderer can check/review receipts;
these actions never resend the filter adjustment. Raw renderer dispatch is blocked.

Source checks: 52 macOS TCI Swift tests, 8 focused TCI Rust tests, 9 frontend TCI
tests and TypeScript checking. Related Station Control, selection and TCI filter
Rust suites pass 85 tests together; adding existing manual-tune frontend checks
passes 23 frontend tests together.

Limits: this is source/fake-socket acceptance only. No real radio, WebSocket
endpoint, network scan, installed app, package, RF path or cross-platform runtime
was exercised. The change grants no transmit, PTT, carrier Tune, split/TX VFO,
spot, CW, audio or IQ authority. TCI has no request correlation IDs: the evidence
proves an observed matching post-intent filter state, not exclusive causation by
this client in a multi-client radio session.
