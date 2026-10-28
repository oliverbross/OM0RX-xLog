from pathlib import Path
import csv,hashlib,json,re,subprocess
R=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
E=R/'docs/reviews/full-code-review-verification-2026-10-29'

# These final edits record the independently rerun Rust consumer and clean up
# prose. No application or existing test file is read for writing.
p=R/'CODE_REVIEW.md';s=p.read_text()
s=s.replace('service timestamp, configured Host, real-module registry/fldigi, React and schema\ncounterexamples. Native recorder/loopback-TCI evidence was cross-checked against',
 'service timestamp, configured Host, real-module registry/fldigi, actual-source Rust\nrecorder, React and schema counterexamples. Loopback-TCI evidence was cross-checked against')
s=s.replace('`exportADIF`, and `reload/searchChanged` at406/419.', '`exportADIF`, and `reload/searchChanged` at 406/419.')
s=s.replace('with Python3.12', 'with Python 3.12').replace('System Python3.9','System Python 3.9')
s=s.replace('The\n[actual-source Rust probe]', 'The\n[actual-source Rust probe]')
needle='missing marker or fallback alone as the explanation. See'
s=s.replace(needle,'missing marker or fallback alone as the explanation. Root independently reran\nthe offline Cargo harness and asserted the printed state with `root/assert_results.py`. See')
p.write_text(s)
p=E/'README.md';s=p.read_text().replace('results,41 existing','results, 41 existing')
s=s.replace('Root commands, from the repository root:', 'Root commands, from the repository root:')
s=s.replace('The configured Host probe needs', 'The configured Host probe needs')
if 'Root also independently reran' not in s:s+='''
Root also independently reran the unchanged recorder package with `cargo run
--quiet --offline --manifest-path /tmp/xlog-review-verification-20261028-12824393/native/Cargo.toml
--target-dir /tmp/xlog-review-verification-20261028-12824393/native/cargo-target`.
`root/assert_results.py` verifies its printed consumer state together with the
service/legacy counterexamples and schema hash. Consolidation scripts expect the
first-pass report baseline; they are preservation/assembly utilities, not fixes.
'''
s=s.replace('ANSI removed, plus exact raw bytes', 'ANSI/trailing whitespace normalized, plus exact raw bytes')
if 'Official/schema and generated XML files' not in s:s+='''
Official/schema and generated XML files (`.xsd`, `.adx`) retain their exact raw
bytes as `.xsd.gz` / `.adx.gz`; decompress them to the original filename in the
scratch area before executing schema probes. Their uncompressed source hashes
are recorded in `copy-manifest.json`. No primary-source content was altered.
The first staged whitespace check flagged the raw source CRLF/trailing spaces;
lossless gzip preserves them while readable log copies are normalized.
'''
p.write_text(s)

with (E/'REVIEW_INVENTORY.tsv').open() as f:rows=list(csv.DictReader(f,delimiter='\t'))
summary=json.loads((E/'coverage-summary.json').read_text())
assert len(rows)==len({r['path_relative_to_reviewed_root'] for r in rows})==2347
assert summary['filesWithSecondPassInspection']==70
assert summary['depthChangedFiles']==30
assert summary['depthCounts']=={'not reviewed':615,'partially reviewed':93,'fully reviewed':100,'scanned only':1410,'excluded':129}
for r in rows:assert (R/r['path_relative_to_reviewed_root']).exists(),r
report=(R/'CODE_REVIEW.md').read_text()
assert re.findall(r'^### (CR-\d{3}) —',report,re.M)==[f'CR-{i:03}' for i in range(1,13)]
assert report.count('**High —')==2 and report.count('**Medium —')==9 and report.count('**Low —')==1

links=[]
for path in [R/'CODE_REVIEW.md',R/'REVIEW_COVERAGE.md',E/'README.md']:
    for match in re.finditer(r'\]\((/Users/[^)]+)\)',path.read_text()):
        target=match.group(1);line=None
        if re.search(r':\d+$',target):target,line=target.rsplit(':',1);line=int(line)
        dest=Path(target);assert dest.exists(),(path,target)
        if line:assert line<=len(dest.read_text().splitlines()),(target,line)
        links.append({'document':str(path.relative_to(R)),'target':match.group(1)})
    for ln,text in enumerate(path.read_text().splitlines(),1):
        if text.startswith('|'):
            count=len(re.split(r'(?<!\\)\|',text))-2
            # CODE_REVIEW has3-column disposition/workflow or2-column checks;
            # coverage has4-column subsystem or4-column depth tables.
            assert count in [2,3,4],(str(path),ln,count)

# First-pass evidence is immutable, and the task has changed only docs/reports.
changed=subprocess.check_output(['git','diff','HEAD','--name-only'],cwd=R,text=True).splitlines()
assert all(p in ['CODE_REVIEW.md','REVIEW_COVERAGE.md'] or p.startswith('docs/reviews/full-code-review-verification-2026-10-29/') for p in changed),changed
assert not subprocess.check_output(['git','diff','HEAD','--',str(R/'docs/reviews/full-code-review-2026-10-28')],cwd=R)
subprocess.run(['git','diff','--check'],cwd=R,check=True)
qa={'status':'PASS','baselineFiles':2347,'secondPassInspectedFiles':70,'changedDepthFiles':30,
    'findingCounts':{'High':2,'Medium':9,'Low':1},'checkedLocalLinks':len(links),
    'reportTableCellCounts':'valid','applicationChanges':[],
    'firstPassEvidenceUnchanged':True,'rootIndependentResults':'assert_results.py passed',
    'scope':'Documentation and isolated reproduction artifacts only; full audit remains incomplete'}
(E/'REPORT_VALIDATION.json').write_text(json.dumps(qa,indent=2)+'\n')

# The copied original logs keep exact raw bytes in gzip. Hash durable artifacts
# after report/index validation; SHA256SUMS intentionally excludes itself.
entries=[]
for path in sorted(E.rglob('*')):
    if path.is_file() and path.name!='SHA256SUMS':
        entries.append(hashlib.sha256(path.read_bytes()).hexdigest()+'  '+str(path.relative_to(E)))
(E/'SHA256SUMS').write_text('\n'.join(entries)+'\n')
print(json.dumps(qa,indent=2))
