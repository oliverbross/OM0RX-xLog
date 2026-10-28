from pathlib import Path
import csv,hashlib,json,re,subprocess,collections
root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
evidence=root/'docs/reviews/full-code-review-2026-10-28'
source='4bd554a25951ddc995b4bef1715d3df12918a07b'
expected=set(filter(None,subprocess.check_output(['git','ls-tree','-r','--name-only',source],cwd=root).decode().splitlines()))
rows=list(csv.DictReader((evidence/'REVIEW_INVENTORY.tsv').open(),delimiter='\t'))
actual={r['path_relative_to_reviewed_root'] for r in rows}
assert expected==actual and len(rows)==len(actual)==2347
summary=json.loads((evidence/'coverage-summary.json').read_text())
assert dict(collections.Counter(r['depth'] for r in rows))==summary['depthCounts']
report=(root/'CODE_REVIEW.md').read_text()
assert re.findall(r'^### (CR-\d{3})',report,re.M)==[f'CR-{i:03d}' for i in range(1,11)]
for name in ['CODE_REVIEW.md','REVIEW_COVERAGE.md']:
    content=(root/name).read_text()
    for path in re.findall(r'\]\((/Users/oliver/[^)]+)\)',content):
        target=re.sub(r':\d+$','',path)
        assert Path(target).exists(),(name,path)
        if re.search(r':\d+$',path):
            line=int(path.rsplit(':',1)[1])
            assert 1<=line<=len(Path(target).read_text().splitlines()),path
for line in (evidence/'SHA256SUMS').read_text().splitlines():
    sha,path=line.split('  ',1)
    assert hashlib.sha256((evidence/path).read_bytes()).hexdigest()==sha,path
changed=subprocess.check_output(['git','diff','--name-only',source],cwd=root).decode().splitlines()
allowed=lambda p:p in ['CODE_REVIEW.md','REVIEW_COVERAGE.md'] or p.startswith('docs/reviews/full-code-review-2026-10-28/')
assert all(allowed(p) for p in changed),changed
print('PASS: inventory exactly matches2347 baseline files; ten stable findings; local links/line references valid; evidence hashes match; no application-source diff.')
print('Evidence files',len(list(p for p in evidence.rglob('*') if p.is_file())))
