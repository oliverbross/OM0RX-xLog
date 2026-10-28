"""Validate only audit documentation/evidence and preservation; never operate xLog."""
import datetime
import gzip
import hashlib
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
ARCHIVE = ROOT / 'docs/reviews/final-code-audit-2026-10-29'
REPORT = ROOT / 'FINAL_CODE_AUDIT.md'
AUDITED = '0ce97a12bb06f1fb7c501c3f1286ae9bb1aca450'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

manifest = json.loads((ARCHIVE / 'baseline-source-sha256.json').read_text())
source_mismatches = [name for name, expected in manifest.items()
                     if sha((ROOT / name).read_bytes()) != expected]
assert not source_mismatches, source_mismatches
changed = json.loads((ARCHIVE / 'changed-inputs.json').read_text())
coverage = json.loads((ARCHIVE / 'changed-input-coverage.json').read_text())
assert len(changed) == 60 and len(coverage) == 60
assert set(changed) == {row['file'] for row in coverage}
assert all(row['reviewers'] and row['ledger'] for row in coverage)
for row in coverage:
    for ledger in row['ledger']:
        assert (ARCHIVE / ledger).is_file(), ledger

index = json.loads((ARCHIVE / 'artifact-index.json').read_text())
for row in index:
    path = ARCHIVE / row['archive']
    data = path.read_bytes()
    assert len(data) == row['archiveBytes'] and sha(data) == row['archiveSHA256'], path
    raw = gzip.decompress(data) if row['compression'].startswith('gzip') else data
    assert len(raw) == row['originalBytes'] and sha(raw) == row['originalSHA256'], path
json_files = list(ARCHIVE.rglob('*.json'))
for path in json_files:
    json.loads(path.read_text())

report = REPORT.read_text()
assert set(re.findall(r'^### (FA-\d{3}) ', report, re.M)) == {'FA-%03d' % i for i in range(1, 8)}
assert set(re.findall(r'^\| (CR-\d{3}) /', report, re.M)) == {'CR-%03d' % i for i in range(1, 13)}
checked_links = 0
for markdown in [REPORT, ARCHIVE / 'README.md']:
    for target in re.findall(r'\[[^\]]+\]\((/[^\n)]+)\)', markdown.read_text()):
        match = re.fullmatch(r'(.*):(\d+)', target)
        path = pathlib.Path(match.group(1) if match else target)
        assert path.exists(), (markdown, target)
        if match:
            assert 0 < int(match.group(2)) <= len(path.read_text().splitlines()), target
        checked_links += 1
    for number, line in enumerate(markdown.read_text().splitlines(), 1):
        assert line == line.rstrip(), (markdown, number, 'trailing whitespace')

previous = json.loads((ROOT / 'docs/reviews/stability-2026-10-29/receipts/baseline.json').read_text())
restored = json.loads((ROOT / 'docs/reviews/stability-2026-10-29/receipts/restoration-final.json').read_text())
node_inode = (ROOT / 'prototype/node_modules').stat().st_ino
cw_inode = (ROOT / '.build/cw-native').stat().st_ino
assert node_inode == previous['nodeModulesInode'] == restored['nodeModulesOriginalInode']
assert cw_inode == restored['cwOriginalInode']
dist = ROOT / 'prototype/dist'
actual_dist = {str(path.relative_to(dist)): sha(path.read_bytes())
               for path in dist.rglob('*') if path.is_file()}
assert actual_dist == previous['distHashes'], 'Original dist changed'

allowed_prefix = 'docs/reviews/final-code-audit-2026-10-29/'
def permitted(name):
    return name == 'FINAL_CODE_AUDIT.md' or name.startswith(allowed_prefix)
tracked_changes = [x.decode() for x in git('diff', '--name-only', '-z', AUDITED).split(b'\0') if x]
untracked = [x.decode() for x in git('ls-files', '--others', '--exclude-standard', '-z').split(b'\0') if x]
assert all(permitted(name) for name in tracked_changes + untracked), tracked_changes + untracked
assert not any(path.is_symlink() for path in ARCHIVE.rglob('*'))
receipt = {
    'observedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'auditedSourceHead': AUDITED,
    'executionHead': git('rev-parse', 'HEAD').decode().strip(),
    'applicationSupportInputsRehashed': len(manifest),
    'sourceMismatches': source_mismatches,
    'changedInputsAccountedFor': len(coverage),
    'importedArtifactsVerified': len(index),
    'jsonFilesParsed': len(json_files),
    'reportLocalLinksChecked': checked_links,
    'findingHeadings': 7,
    'originalFindingVerdicts': 12,
    'reportSHA256': sha(REPORT.read_bytes()),
    'originalNodeModulesInode': node_inode,
    'originalCWDirectoryInode': cw_inode,
    'originalDistFilesAndHashesPreserved': len(actual_dist),
    'gitChangesLimitedToAuditOutputs': True,
    'result': 'PASS',
    'boundary': 'Documentation/evidence integrity and preservation, not an application test or release acceptance.'
}
(ARCHIVE / 'final-validation.json').write_text(json.dumps(receipt, indent=2) + '\n')
checksum_paths = [REPORT] + sorted(path for path in ARCHIVE.rglob('*')
                                   if path.is_file() and path.name != 'SHA256SUMS')
(ARCHIVE / 'SHA256SUMS').write_text(''.join(sha(path.read_bytes()) + '  ' + str(path.relative_to(ROOT)) + '\n'
                                         for path in checksum_paths))
print(json.dumps(receipt, indent=2))
