# Preserved workspace recovery — 12 October 2026

The signed alpha.2 launch initially displayed onboarding instead of the existing
logbook. Inspection established that the worker was replying correctly:
`workspace_status` returned false because the expected application-support
directories were absent. This was **not an IPC deadlock**.

Both the original native logbook and the private integration workspace, including
their SQLite WAL/SHM companions, were found in Trash. Integration-service settings
and the matching preferences were there too. No new workspace was created.

With xLog and its worker stopped, the three exact directories were copied back
to Application Support without overwriting any destination. Recursive comparison
reported identical source and destination contents. The Trash copies remain as
recovery backups. Only the native preference domain and the integration domain
identified by the restored workspace manifest were restored; unrelated test
preference domains were not restored.

Read-only verification of the recovered integration database returned
`PRAGMA quick_check = ok` and **67,843 QSOs**. The installed app then displayed
67,843 contacts, its existing draft, station callsign/grid and real propagation
data. No contact was added, edited, deleted or synchronized during recovery.
No bearer token or preference contents were included in tool output or Git.

The project baseline already records a Trash-triggered profile-cleanup incident.
That is consistent with this observation, but the current cleanup actor was not
identified. Future replacements must preserve the outgoing application in a
rollback directory **outside Trash**, keep only the current bundle in
Applications for each distinct application, and verify both application-support directories before and after
replacement. Do not use an app uninstaller or clean related data.

The startup UI now distinguishes an unknown or failed workspace check from a
confirmed first launch. It never offers creation while the existing-data check
is pending or failed. A disposable-workspace concurrent worker regression covers
the real logbook startup methods without opening the operator's database.

## Original native application restored

On the operator's explicit request, `/Applications/OM0RX-xLog.app` was restored
from the retained `OM0RX-xLog-native.app` bundle on 12 October. It is the exact
native v0.3.0 build 6 baseline, bundle ID `com.oliverbross.OM0RXXLog`, with
executable SHA-256 `7a2b244545c9eb2639cde5f0a152c9cfaf40e2e06fde9ad97fd3184e37efdb97`.
Strict code-signature verification and stapled-ticket validation passed;
Gatekeeper accepted it as `Notarized Developer ID`. Launch Services was refreshed.
The app was not launched, and neither database nor preferences were modified.

**Retain both distinct applications:** the original native `OM0RX-xLog.app`
and the developing `OM0RX-xLog Integration.app`. The operator's request to remove
obsolete builds does not authorize removing the preserved native app again.
