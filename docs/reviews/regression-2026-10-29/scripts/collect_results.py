from pathlib import Path
import collections, hashlib, json, re, sqlite3, subprocess
from urllib.parse import quote

root=Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
task=Path('/tmp/xlog-phase4-20261029-26f795cb')
logs=task/'logs'
def text(name): return (logs/(name+'.log')).read_text(errors='replace')
def swift_counts(name):
    lines=text(name).splitlines()
    counts=[]; skipped=0
    for index,line in enumerate(lines):
        marker = "Test Suite 'All tests' passed" if any("Test Suite 'All tests' passed" in value for value in lines) else "Test Suite 'Selected tests' passed"
        if marker in line:
            next_line=lines[index+1]
            counts.append(int(re.search(r'Executed (\d+) tests?',next_line)[1]))
            match=re.search(r'with (\d+) tests? skipped',next_line)
            skipped+=int(match[1]) if match else 0
    testing=[int(m[1]) for line in lines if (m:=re.search(r'Test run with (\d+) tests.* passed',line))]
    disabled=[line for line in lines if line.startswith('➜ Test ') and 'skipped.' in line]
    return {'xctestCases':sum(counts),'xctestSkipped':skipped,'executables':counts,'swiftTestingSummaryCount':sum(testing),'swiftTestingDisabledCases':disabled}
commands=[]
for p in logs.glob('*.json'):
    if p.name.endswith('.running.json'): continue
    row=json.loads(p.read_text())
    body=text(row['id'])
    row['rawLogSHA256']=hashlib.sha256((logs/(row['id']+'.log')).read_bytes()).hexdigest()
    rss=re.findall(r'(\d+)\s+maximum resident set size',body)
    row['timeReportedMaximumRSSBytes']=int(rss[-1]) if rss else None
    commands.append(row)
commands.sort(key=lambda r:r['startedUTC'])
assert all(not row['timedOut'] and row.get('exitCode') is not None for row in commands)

counts={name:swift_counts(name) for name in ['NATIVE-FULL','PORTABLE-TESTS-R2','SWIFT-TSAN','CW-WIRE-HARNESS','LARGE-DATASET-BENCHMARKS','GENERATED-LARGE-PERFORMANCE','AWARD-CATALOGUE-SCALE','QUERY-BENCHMARK-COPY','PUBLIC-FEED-PROBES']}
for name in ['FRONTEND-FULL','FRONTEND-STANDARD-FULL']:
    body=text(name)
    files=re.search(r'Test Files\s+(\d+) passed',body)
    tests=re.search(r'Tests\s+(\d+) passed',body)
    counts[name]={'vitestFiles':int(files[1]),'vitestPassed':int(tests[1]),'nodePassed':2}
counts['RUST-TESTS-R2']={'results':[int(x) for x in re.findall(r'test result: ok\. (\d+) passed',text('RUST-TESTS-R2'))]}
counts['RUST-CONTESTING-FEATURE']={'results':[int(x) for x in re.findall(r'test result: ok\. (\d+) passed',text('RUST-CONTESTING-FEATURE'))]}
counts['WORKER-PROTOCOL']={'summaries':[line for line in text('WORKER-PROTOCOL').splitlines() if re.search(r'(?:#|ℹ)\s*(?:tests|pass|fail|skipped)\s+\d+',line)]}
counts['PYTHON-FULL-R2']={'passed':int(re.search(r'Ran (\d+) tests',text('PYTHON-FULL-R2'))[1])}
counts['CONTEST-GENERATOR-TESTS-R2']={'passed':int(re.search(r'Ran (\d+) tests',text('CONTEST-GENERATOR-TESTS-R2'))[1])}
readiness=json.loads((task/'all-contests-readiness.json').read_text())
counts['ALL-CONTESTS']={'catalogueCount':readiness['catalogueCount'],'plugins':len(readiness['plugins']),
    'statuses':dict(collections.Counter(c['status'] for p in readiness['plugins'] for c in p['checks'].values()))}
browsers=[]
for folder in sorted(task.glob('browser-*')):
    path=folder/'evidence/acceptance.json'
    if not path.is_file():continue
    value=json.loads(path.read_text())
    browsers.append({'folder':folder.name,'ok':value['ok'],'frames':value.get('frameCount'),
        'plannedCases':len(value.get('cases',[])),'observations':len(value.get('observations',[])),
        'simulatedOutput':len(value.get('simulatedOutput',[])),'exports':len(value.get('exports',[])),
        'protectedDatabaseMetadataUnchanged':value.get('protectedDatabaseMetadataUnchanged'),
        'failure':value.get('failure'),'boundary':value.get('boundary')})
assert all(x['protectedDatabaseMetadataUnchanged'] for x in browsers)

databases=[]; non_sqlite=[]
for folder in sorted([*task.glob('browser-*'),*task.glob('worker-bootstrap*')]):
    if not folder.is_dir():continue
    for path in sorted(folder.rglob('*')):
        if not path.is_file() or path.suffix not in ['.db','.sqlite','.sqlite3']:continue
        with path.open('rb') as f: header=f.read(16)
        if header!=b'SQLite format 3\x00':
            non_sqlite.append({'path':str(path.relative_to(task)),'bytes':path.stat().st_size})
            continue
        db=sqlite3.connect('file:'+quote(str(path))+'?mode=ro',uri=True,timeout=5)
        try:
            integrity=[row[0] for row in db.execute('PRAGMA integrity_check')]
            foreign=list(db.execute('PRAGMA foreign_key_check'))
            version=db.execute('PRAGMA user_version').fetchone()[0]
            tables=[row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
            databases.append({'path':str(path.relative_to(task)),'integrity':integrity,'foreignKeyViolations':foreign,'userVersion':version,'tables':tables})
        finally:db.close()
assert databases and all(x['integrity']==['ok'] and not x['foreignKeyViolations'] for x in databases)

original=json.loads((task/'source-sha256.json').read_text())
changed=[name for name,digest in original.items() if hashlib.sha256((root/name).read_bytes()).hexdigest()!=digest]
assert not changed, changed
status=subprocess.check_output(['git','status','--porcelain=v1'],cwd=root,text=True)
assert not status.strip(),status
pins={source:hashlib.sha256((root/source).read_bytes()).hexdigest() for source in [
    'vendor/deepcw-engine/model.onnx','vendor/deepcw-engine/model.onnx.json','.build/cw-package/runtime/lib/libonnxruntime.1.24.3.dylib']}
assert pins['vendor/deepcw-engine/model.onnx']=='ef120799457bca042d4690944f0faf93268eb4654e7f50f28784ad63bdc1fe02'
assert pins['vendor/deepcw-engine/model.onnx.json']=='b4342157b90229ee7380e165f3d8036179b80d1e6ae02f2557388b7fcd558c01'
assert pins['.build/cw-package/runtime/lib/libonnxruntime.1.24.3.dylib']=='81b90223e770bfaea12783cb99370258387bae7ed70ff7e99f2717382800d217'
result={'sourceHead':subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip(),
    'applicationFilesHashed':len(original),'applicationFilesChanged':changed,'commands':commands,'counts':counts,
    'browsers':browsers,'databaseIntegrity':databases,'nonSQLiteNamedFiles':non_sqlite,'nativePins':pins,
    'resourceMetricLimit':'time-l maximum RSS is a command resource receipt, not a simultaneous whole-process-tree peak or a leak-soak result.'}
(task/'results.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'commands':len(commands),'counts':counts,'browsers':browsers,'databasesChecked':len(databases),'nonSQLiteNamedFiles':non_sqlite,'sourceFilesChanged':changed}))
