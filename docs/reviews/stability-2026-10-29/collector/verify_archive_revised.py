"""Independently verify raw evidence, final gates/counts, restoration and manifest."""
import datetime
import gzip
import hashlib
import json
import subprocess
from collector_common import (ROOT, TASK, assert_gates, assert_head, is_database,
                              parse_plan, read_json, sha, source_snapshot,
                              suite_counts, within, write_json)

def main():
    plan = parse_plan()
    assert_head(plan)
    source = source_snapshot(plan)
    assert_gates(plan)
    counts, details = suite_counts(plan)
    archive = ROOT / 'docs/reviews/stability-2026-10-29'
    assert (archive / 'README.md').is_file() and (archive / 'COMMANDS.md').is_file(), 'Finalize both evidence indexes before verification'
    records = read_json(archive / 'raw-artifact-index.json')
    assert not any(path.is_symlink() for path in archive.rglob('*')), 'Archive must not contain symlinks'
    by_source = {}
    for item in records:
        archived = within(archive / item['archive'], [archive])
        data = archived.read_bytes()
        raw = gzip.decompress(data) if item['gzip'] else data
        assert len(raw) == item['rawBytes'] and hashlib.sha256(raw).hexdigest() == item['rawSHA256'], item
        assert not is_database(item['source']), item
        assert not raw.startswith((b'SQLite format 3\0', b'\x7fELF', b'MZ', b'\xfe\xed\xfa', b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe')), item
        by_source[item['source']] = item
    summary = read_json(archive / 'results.json')
    assert summary['sourceHead'] == plan['head'] and summary['compiledSourceFiles'] == len(source)
    assert summary['completeSuiteCounts'] == counts and summary['suiteCountDetails'] == details
    exports = read_json(archive / 'export-verification.json')
    assert exports and all(item['matchesReceipt'] for item in exports)
    for item in exports:
        record = by_source[item['path']]
        assert record['rawBytes'] == item['bytes'] and record['rawSHA256'] == item['sha256'], item
    integrity = read_json(archive / 'database-integrity.json')
    assert integrity and all(item['integrityCheck'] == ['ok'] and not item['foreignKeyCheck'] for item in integrity)
    restore = read_json(TASK / 'restoration-final.json')
    baseline = read_json(TASK / 'baseline.json')
    assert restore['sourceHead'] == plan['head'] and restore['finalSourceFilesVerified'] == len(source)
    assert restore['originalDistFiles'] == 180 and restore['originalDistHashesMatch'] is True
    node = ROOT / 'prototype/node_modules'
    cw = ROOT / '.build/cw-native'
    assert not node.is_symlink() and node.stat().st_ino == baseline['nodeModulesInode'] == 560040948
    assert not cw.is_symlink() and cw.stat().st_ino == plan.get('originalCWInode', 589158794)
    dist = ROOT / 'prototype/dist'
    assert {str(path.relative_to(dist)): sha(path) for path in dist.rglob('*') if path.is_file()} == baseline['distHashes']
    allowed_docs = {'CODE_REVIEW.md', 'REMEDIATION_TRACKER.md', 'REGRESSION_TEST_REPORT.md',
                    'REVIEW_COVERAGE.md', 'STABILITY_REPORT.md'}
    changed = subprocess.check_output(['git', 'diff', '--name-only', 'HEAD'], cwd=ROOT, text=True).splitlines()
    assert all(name in allowed_docs or name.startswith('docs/reviews/stability-2026-10-29/') for name in changed), changed
    untracked = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=ROOT, text=True).splitlines()
    assert all(name.startswith('docs/reviews/stability-2026-10-29/') for name in untracked), untracked
    receipt = {'verifiedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'sourceHead': plan['head'], 'rawArtifactsVerified': len(records),
               'compiledSourceFilesUnchanged': len(source), 'exportsComparedToReceipts': len(exports),
               'readOnlyPrivateDatabaseChecks': len(integrity), 'allRawHashesMatch': True,
               'originalFixturesRestored': True, 'completeSuiteCountsVerified': True,
               'onlyTrackedChanges': changed, 'onlyUntrackedChanges': untracked}
    write_json(archive / 'archive-verification.json', receipt)
    manifest = {str(path.relative_to(archive)): sha(path) for path in sorted(archive.rglob('*'))
                if path.is_file() and path.name != 'SHA256SUMS'}
    (archive / 'SHA256SUMS').write_text(''.join(value + '  ' + name + '\n' for name, value in manifest.items()))
    for name, expected in manifest.items():
        assert sha(archive / name) == expected, name
    print(json.dumps({**receipt, 'archiveManifestFiles': len(manifest), 'completeSuiteCounts': counts}))

if __name__ == '__main__':
    main()
