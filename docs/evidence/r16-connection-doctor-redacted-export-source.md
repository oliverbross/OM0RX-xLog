# R16 Connection Doctor redacted export — source acceptance

The Connection Doctor now offers “Export redacted report…” only after its existing
typed preview is verified. Nothing exports on mount, focus or telemetry wakes.
Clicking captures the displayed preview and opens a native Save dialog with the
fixed suggested filename `xlog-connection-doctor-redacted.json`.

The export command accepts the same closed categories as the existing preview.
Native serde enums and `deny_unknown_fields` reject arbitrary strings and extra
fields at every object boundary. Schema version, stage order, stage count and
unique bounded capabilities are checked before any Save dialog. The resulting
JSON contains only the allowlisted provider/configuration/transport/freshness/
read-only/capability/check categories. It cannot represent credentials, endpoints,
identifiers, raw errors, radio values, timestamps or log contents. It serializes
deterministically and ends with a newline.

Native authorization permits only the exact `connection-doctor` window, rejects
isolated acceptance and app shutdown, and rechecks authorization after the Save
dialog. One native export lease prevents concurrent dialogs; the renderer also
fences repeat clicks. Native-selected paths never return to the renderer. Cancel
returns a distinct cancelled outcome and creates no file. Save uses a temporary
file in the selected directory and atomic persistence; failures expose fixed copy
without paths or system errors. macOS reuses the existing main-thread native
panel dispatch pattern; other desktop targets use the existing rfd dependency.

Export invokes no snapshot, worker, station owner, network, reconnect, device or
RF operation. Existing focus/telemetry-driven retained preview updates continue
independently. This is source acceptance only: installed-app Save/Cancel,
overwrite-dialog behavior and real retained-provider acceptance remain open.
No installed app, live service, FTP/FTPS implementation or output artifact was
changed by this stage.

Focused verification:

- Frontend Connection Doctor adapter and component tests: 8 passed.
- Native Connection Doctor tests: 8 passed, covering exact-surface authorization, malformed
  fields and values, deterministic serialization, cancellation, file bytes,
  sanitized write failure and concurrent export ownership.
- Native tests compile the macOS native command and panel wiring successfully.
- `npm run build`: TypeScript and Vite production compilation pass. The final
  shared bundle graph gate fails for Logbook late CSS
  (`assets/ContactEditStatus-O-xrNTNQ.css`), outside this stage's changed surfaces.
  Full production-build acceptance therefore remains open.
