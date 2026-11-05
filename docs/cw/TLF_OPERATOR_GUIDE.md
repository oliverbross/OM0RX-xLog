# CW sequence and call operation

These are source changes following the approved TLF plan. They have software verification; no new hardware, RF or installed-app acceptance is asserted. Existing plain messages and full-call correction remain the defaults.

## Message speeds

In Productivity → Messages, choose a Run or S&P message. Put `{WPM:32}` before a faster section and `{WPM:BASE}` where the captured base speed should resume. The editor can append these directives; edit the existing template to position them. Example:

```text
{CALL} {WPM:32}{RST} {SENTNR}{WPM:BASE} TU
```

Preview shows the provider-ready cut/padded text and each speed/restore segment from the same Python compiler used for dispatch. A missing serial stays unavailable; example serials are simulated. Preview/import/save never reserve a serial or send. A final base restore is included when a speed directive was used. Literal plus/minus characters remain text.

WinKeyer supports documented buffered speed commands. Flex and direct TCI reject queued speed sections before sending; use an explicitly edited plain single-speed message on an ordinary supported route. The shared CW workbench now supports literal live append through native macOS direct Flex LAN when indexed replies and own-client status prove attribution. **Radio reported** character progress is separate from command acceptance and RF. Ambiguous attribution disables live typing; Stop and staged whole-message Send remain available. Flex contest early-call/exact-lane streaming and buffered speed changes are outside this milestone; physical FLEX-8400 qualification remains open. Adapter/protocol limits and primary references are in [the adapter contract](TLF_ADAPTER_PROTOCOL.md).

## Early callsign

Use the authoritative single-lane Run/CW desk, choose the WinKeyer route and arm CW from that desk. Enable **Early start from deliberate typing** and set the threshold (2–8, default 3), or use **Start current call explicitly**. The option resets off at a session/draft boundary. Advanced exact-lane streaming and detached entry are not advertised where that route is unavailable; existing lane/Entry output remains separate.

Only direct typing starts the threshold path. Paste, history, SCP, hydration and restore do not start output. Submitted call prefixes are immutable; editing one requires Stop and corrected-call recovery. Ordinary typing advances one bounded stream with monotonic host revisions. The ordinary ESM action closes that stream, queues the matching exchange once and suppresses only its matching automatic call token. An explicit F-key call/repeat remains a new action. Logging still requires the normal deliberate plugin commit.

Stop targets the original owner and keeps the draft/exchange/serial. A missing reply, disconnect or restart never resumes or rearms a stream. Inspect uncertainty before starting another action. Queue admission is not RF progress, completed device output or proof the other station copied the call.

## Corrected call

**Full call** is the default. **Changed component with complete provider evidence** uses a single unambiguous changed suffix or prefix/district component only after the exact earlier complete call has provider acceptance on the same draft/provider generation. WinKeyer software-queue admission alone does not qualify. Planned ESM state, portable or multiple-component changes, Stop, uncertain outcomes and replacement bindings fall back to the full call. The full call and raw exchange remain in the log.

## Physical qualification still required

With a separately authorized non-radiating setup, record device/firmware, serial connection generation and selected owner. Check a two-speed sequence, a slow typed `OM0RX` through real draft revisions and ordinary ESM, explicit repeat, queued edits, XOFF, Stop during a pending reply and disconnect/reconnect. Verify the actual keying boundary, word gap, speed restore and absence of duplicate call/exchange. Repeat on any surface advertised for the adapter. Preserve an uncertain release; reconnect must not resume. Record Flex separately; WinKeyer results cannot qualify Flex.

OK/OM setup and export: [OK/OM DX CW](../contesting/OKOM_DX_CW.md). QTC operation: [QTC desk](../contesting/TLF_QTC_OPERATIONS.md). Passes and rule guidance: [directed passes and timing](../contesting/TLF_PASSES_AND_OPERATING_GUIDANCE.md).
