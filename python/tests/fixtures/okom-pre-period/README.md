# Genuine pre-period-correction OK/OM fixture

`contest.sqlite.gz` was created by the actual Host at canonical commit
`5016751a03f2adc6eea27def34ed4675e6bdc67a` (1.5.7), using its existing
`OKOMHostTests` setup and pinned country/district evidence. No SQL points were
fabricated: the old Host committed OK1ABC/APA at 11:59:59 and 12:00:00 UTC on
14 November 2026, 14025000 Hz, and produced points `[3, 0]`.
All records are synthetic and disposable; no production store was copied.
The manifest retains source, identities and compressed/raw digests.

Recreate from this canonical checkout (no worktree/build/install):

```sh
mkdir -p .build/tlf-followup/pre-period-source
git archive 5016751a03f2adc6eea27def34ed4675e6bdc67a python | tar -x -C .build/tlf-followup/pre-period-source
PYTHONPATH=.build/tlf-followup/pre-period-source/python:.build/tlf-followup/pre-period-source/python/tests /opt/local/bin/python3.12 python/tests/fixtures/okom-pre-period/create.py
```

Regeneration uses fresh IDs/timestamps; the resulting manifest/digests change.
Tests verify the retained bytes and then use a new disposable copy.
