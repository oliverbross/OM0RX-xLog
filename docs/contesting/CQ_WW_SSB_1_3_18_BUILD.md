# macOS 1.3.18 — nonblocking prior radio spot cleanup

Implementation source: `2dc0e61739cb3eaed0324c193c2ed4a76e47638c`. Build from clean canonical main with
`bash prototype/scripts/package-macos.sh`. The version commit is embedded as
sourceCommit in DistributionMetadata/components.json and Not1MM/python-runtime.json.

On 1.3.17 the operator reported missing Flex/Maestro markers. Read-only inventory
timestamps showed no new acceptance until the last retained receipt reached its
600-second expiry. Fresh acceptance resumed one second after that expiry. A
focused test reproduced failed old-marker removal preventing current publication.

Current validated contest spots now publish independently of prior-marker cleanup.
Cleanup runs as one owned task; failures retain receipts for later retry and are
reported in Radio spots status. A frozen cutoff and exact-receipt checks prevent
cleanup from deleting newly republished markers. Reload/merge preserves receipts
accepted concurrently for other spots. Publisher identity/revision checks remain.

Analytics is retained at Contest → Analytics… and was opened on installed 1.3.17
with the operator's 351-contact log. No Analytics menu entry was removed.
Checking recovery and compact frequency displays are retained. Recorder work is
preserved separately and excluded. No production contact or RF/PTT/audio/rotor
operation is used for acceptance. Installed evidence follows after packaging.

## Installed acceptance — READY WITH LIMITATIONS

Exact installed source: `78a294206216e490699716f5088acd25707f5eed`.
Both embedded receipts and installed/candidate component hashes match. Developer ID
deep/strict verification passed; notarization unclaimed. Candidate and installed
packaged Python each passed 35 disposable checks. All 35 isolated native checks
passed with station I/O disabled. The cleanup and broker suite passed 50 tests;
independent review cleared the corrected TCI and radio-identity concurrency paths.
The first native run timed out waiting for its isolated Logbook editor after 20
completed checks; the unchanged candidate passed all 35 checks on rerun.

Fresh backup preserved 361 contacts. All QSO, identity and audit rows matched
before relaunch. Existing contest windows reopened and the cluster reconnected.
Unlike the retained receipt sample from 1.3.17, both new radio-delivery samples
count only acceptance timestamps after this launch request. The first sample had
9 fresh receipts at
32.578 seconds after launch request; the
later sample had 10 fresh receipts and an advancing
acceptance timestamp after more than one minute. This confirms fresh agent
acceptance rather than merely the presence of old persisted receipts. Physical
Maestro marker display and long-duration behavior remain separate observations.

Backup: `/Users/oliver/Documents/Backups/OM0RX-xLog-1.3.18-before-install-20261025`.
Rollback: `/Applications/OM0RX-xLog-previous-1.3.17-20261025.app`.
The recorder checkpoint and managed worktree remain separate; no unfinished
recorder code or audio action is included in this candidate.

[Installed source and fresh-delivery evidence](evidence/cq-ww-ssb-1.3.18/release-verification.json).
