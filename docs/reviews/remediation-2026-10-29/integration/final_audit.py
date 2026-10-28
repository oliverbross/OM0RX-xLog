from pathlib import Path
import hashlib, json, re, subprocess

root = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
scratch = Path('/tmp/xlog-remediation-20261029')
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root, text=True).strip()

tracker = (root/'REMEDIATION_TRACKER.md').read_text()
ids = re.findall(r'^## (CR-\d{3}) — ', tracker, re.M)
statuses = re.findall(r'^- \*\*Status:\*\* (.+)\.$', tracker, re.M)
assert ids == [f'CR-{i:03d}' for i in range(1, 13)], ids
assert statuses == ['Fixed and Verified'] * 12, statuses
review = (root/'CODE_REVIEW.md').read_text()
assert len(re.findall(r'^\*\*Remediation status:\*\* Fixed and Verified\.', review, re.M)) == 12

hashes = 0
for manifest in (root/'docs/reviews/remediation-2026-10-29').glob('*/SHA256SUMS'):
    for line in manifest.read_text().splitlines():
        expected, name = line.split('  ', 1)
        assert hashlib.sha256((manifest.parent/name).read_bytes()).hexdigest() == expected, str(manifest.parent/name)
        hashes += 1

missing = []
for name in ['CODE_REVIEW.md', 'REVIEW_COVERAGE.md', 'REMEDIATION_TRACKER.md']:
    for target in re.findall(r'\]\((/[^)]+)\)', (root/name).read_text()):
        path = re.sub(r':\d+$', '', target.split('#')[0])
        if not Path(path).exists(): missing.append([name, target])
assert not missing, missing
assert not git('diff', '--name-only', '530de4c4..HEAD', '--', 'docs/reviews/full-code-review-2026-10-28', 'docs/reviews/full-code-review-verification-2026-10-29')
# Full Python, readiness, Swift and Rust runs began before the last two renderer-only commits.
assert not git('diff', '--name-only', '94396af7..HEAD', '--', 'Sources', 'Tests', 'python', 'prototype/src-tauri')

readiness = json.loads((scratch/'all-contests-readiness.json').read_text())
for name, expected in readiness['sourceFilesSHA256'].items():
    assert hashlib.sha256((root/name).read_bytes()).hexdigest() == expected, name

changed = git('diff', '--name-only', '530de4c4..HEAD', '--', 'Sources', 'Tests', 'python', 'prototype').splitlines()
result = {
    'sourceCommit': git('rev-parse', 'HEAD'),
    'baseline': git('rev-parse', '530de4c4'),
    'findings': dict(zip(ids, statuses)),
    'stageEvidenceHashesChecked': hashes,
    'reportLocalLinks': 'PASS',
    'originalReviewEvidenceUnchanged': True,
    'earlierIntegrationComponentsUnchanged': True,
    'readinessSourceHashesMatchFinalSource': True,
    'sourceFilesSHA256': {name: hashlib.sha256((root/name).read_bytes()).hexdigest() for name in changed},
    'commits': git('log', '--format=%H %s', '--reverse', '530de4c4..HEAD').splitlines(),
}
(scratch/'final-audit.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps({key:value for key,value in result.items() if key not in ['sourceFilesSHA256', 'commits', 'findings']}))
