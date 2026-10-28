"""Read-only extractor/filter smoke check against existing bounded evidence."""
from collector_common import TASK, evidence_file, suite_counts

plan = {
    'suiteIds': {'frontend': 'CONVERGED-FRONTEND', 'python': 'SEAL-PYTHON',
                 'nativeSwift': 'SEAL-NATIVE', 'portableSwift': 'SEAL-PORTABLE',
                 'rustDefault': 'SEAL-RUST', 'rustContestingFeature': 'SEAL-RUST-FEATURE'},
    'suiteCounts': {'frontend': {'vitest': 4731, 'files': 339, 'node': 2}, 'python': 556,
                    'nativeSwift': {'xctest': 315, 'swiftTestingSummary': 340},
                    'portableSwift': {'xctest': 1171, 'swiftTestingSummary': 537},
                    'rustDefault': {'unit': 919, 'integrationFunctions': 26},
                    'rustContestingFeature': 926},
}
counts, details = suite_counts(plan)
assert not evidence_file(TASK / 'xlog-prototype-bcfb669c-release-preserved')
assert not evidence_file(TASK / 'empty-query-final.sqlite')
assert not evidence_file(TASK / 'empty-query-final.sqlite-shm')
assert not evidence_file(TASK / 'empty-query-final.sqlite-wal')
assert evidence_file(TASK / 'final-source-sha256.json')
print({'extractorsMatchExistingReceipts': True, 'binaryAndDatabaseFiltersRejectKnownArtifacts': True,
       'scope': 'Read-only mixed historical logs; not a current-head suite acceptance.', 'counts': counts})
