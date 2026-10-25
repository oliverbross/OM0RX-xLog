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
