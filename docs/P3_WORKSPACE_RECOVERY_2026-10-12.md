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
Applications, and verify both application-support directories before and after
replacement. Do not use an app uninstaller or clean related data.

The startup UI now distinguishes an unknown or failed workspace check from a
confirmed first launch. It never offers creation while the existing-data check
is pending or failed. A disposable-workspace concurrent worker regression covers
the real logbook startup methods without opening the operator's database.
