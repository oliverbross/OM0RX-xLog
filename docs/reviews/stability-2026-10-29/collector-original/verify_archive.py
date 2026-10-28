from pathlib import Path
import datetime, gzip, hashlib, json, re, subprocess

root = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
task = Path('/tmp/xlog-phase5-20261029-721e0705')
archive = root / 'docs/reviews/stability-2026-10-29'
records = json.loads((archive / 'raw-artifact-index.json').read_text())
for item in records:
    data = (archive / item['archive']).read_bytes()
    raw = gzip.decompress(data) if item['gzip'] else data
    assert len(raw) == item['rawBytes'] and hashlib.sha256(raw).hexdigest() == item['rawSHA256'], item

source = json.loads((task / 'final-source-sha256.json').read_text())
for name, expected in source.items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected, name

def log(name):
    return (task / 'logs' / (name + '.log')).read_text(errors='replace')
def swift_count(name):
    text = log(name)
    xctest = [int(x) for x in re.findall(r"Test Suite 'All tests' passed[^\n]*\n\s*Executed (\d+) tests?", text)]
    testing = [int(x) for x in re.findall(r'Test run with (\d+) tests? in \d+ suites? passed', text)]
    return {'xctest': sum(xctest), 'swiftTestingSummary': sum(testing)}
native = swift_count('STABLE-NATIVE')
portable = swift_count('STABLE-PORTABLE')
assert native == {'xctest':315,'swiftTestingSummary':340}, native
assert portable == {'xctest':1171,'swiftTestingSummary':537}, portable
front = log('STABLE-FRONTEND')
assert re.search(r'Test Files\s+339 passed', front) and re.search(r'Tests\s+4731 passed', front)
assert re.search(r'Ran 556 tests', log('STABLE-PYTHON'))
assert '914 passed; 0 failed' in log('STABLE-RUST')
assert '26 passed; 0 failed' in log('STABLE-RUST')
assert '921 passed; 0 failed' in log('STABLE-RUST-FEATURE')
summary = json.loads((archive / 'results.json').read_text())
summary['completeSuiteCounts'] = {'nativeSwift':native,'portableSwift':portable,
                                'frontend':{'vitest':4731,'files':339,'node':2},
                                'python':556,'rustDefault':{'unit':914,'integrationFunctions':26},
                                'rustContestingFeature':921,
                                'overlap':'Counts are executions/summaries, not a unique combined test total.'}
(archive / 'results.json').write_text(json.dumps(summary,indent=2)+'\n')

exports = json.loads((archive / 'export-verification.json').read_text())
assert exports and all(x['matchesReceipt'] for x in exports)
integrity = json.loads((archive / 'database-integrity.json').read_text())
assert integrity and all(x['integrityCheck']==['ok'] and not x['foreignKeyCheck'] for x in integrity)
restore = json.loads((task / 'restoration-final.json').read_text())
assert restore['originalDistFiles'] == 180 and restore['originalDistHashesMatch']

allowed_docs = {'CODE_REVIEW.md','REMEDIATION_TRACKER.md','REGRESSION_TEST_REPORT.md',
                'REVIEW_COVERAGE.md','STABILITY_REPORT.md'}
changed = subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=root,text=True).splitlines()
assert all(name in allowed_docs for name in changed), changed
receipt = {'verifiedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'rawArtifactsVerified':len(records),'compiledSourceFilesUnchanged':len(source),
           'exportsComparedToReceipts':len(exports),'readOnlyPrivateDatabaseChecks':len(integrity),
           'allRawHashesMatch':True,'originalFixturesRestored':True,
           'completeSuiteCountsVerified':True,'onlyTrackedChanges':changed}
(archive / 'archive-verification.json').write_text(json.dumps(receipt,indent=2)+'\n')
manifest = {str(p.relative_to(archive)):hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(archive.rglob('*')) if p.is_file() and p.name != 'SHA256SUMS'}
(archive / 'SHA256SUMS').write_text(''.join(value+'  '+name+'\n' for name,value in manifest.items()))
for name,expected in manifest.items():
    assert hashlib.sha256((archive / name).read_bytes()).hexdigest() == expected,name
print(json.dumps({**receipt,'archiveManifestFiles':len(manifest)}))
