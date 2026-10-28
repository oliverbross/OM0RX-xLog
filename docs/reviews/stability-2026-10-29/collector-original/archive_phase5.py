"""Archive bounded, synthetic evidence only, after the guarded checks finish."""
from pathlib import Path
from collections import Counter
import datetime, gzip, hashlib, json, shlex, shutil, sqlite3, subprocess

root = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
task = Path('/tmp/xlog-phase5-20261029-721e0705')
dest = root / 'docs/reviews/stability-2026-10-29'
head = (task / 'final-source-head.txt').read_text().strip()
assert subprocess.check_output(['git','rev-parse','HEAD'], cwd=root, text=True).strip() == head
assert not dest.exists(), dest
for name in ['FINAL-BROWSER-OPERATOR', 'FINAL-BROWSER-FAMILY', 'FINAL-BROWSER-DECLARATIVE',
             'FINAL-BROWSER-NAQP', 'FINAL-BROWSER-SCP-R3', 'FINAL-INTEGRATION-REST',
             'FINAL-IDLE-R2', 'FINAL-HAMLIB-SEQUENCE',
             'FINAL-CW-INTEGRATION', 'FINAL-RUST-RELEASE', 'FINAL-FTP-FTPS',
             'CONVERGED-FRONTEND-R2-SEQUENCE', 'CONVERGED-PYTHON-R2-SEQUENCE',
             'CONVERGED-PORTABLE-R2-SEQUENCE', 'CONVERGED-NATIVE-R2-SEQUENCE',
             'CONVERGED-RUST-R2-SEQUENCE']:
    result = json.loads((task / 'logs' / (name + '.json')).read_text())
    assert result['exitCode'] == 0 and not result['timedOut'], result
for name in ['STABLE-FRONT-SEQUENCE','STABLE-PYTHON-SEQUENCE','STABLE-NATIVE-SEQUENCE',
             'STABLE-PORTABLE-SEQUENCE','STABLE-RUST-SEQUENCE','STABLE-WORKER-SEQUENCE',
             'STABLE-RUST-RELEASE','STABLE-OSV']:
    result = json.loads((task / 'logs' / (name + '.json')).read_text())
    assert result['exitCode'] == 0 and not result['timedOut'], result

dest.mkdir(parents=True)
raw_records = []
def save(path, relative, compress=False):
    data = path.read_bytes()
    relative = Path(relative)
    if compress:
        relative = Path(str(relative) + '.gz')
    target = dest / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    assert not target.exists(), target
    target.write_bytes(gzip.compress(data, mtime=0) if compress else data)
    raw_records.append({'source': str(path), 'archive': str(relative), 'rawBytes': len(data),
                        'rawSHA256': hashlib.sha256(data).hexdigest(), 'gzip': compress})

checks = []
for path in sorted((task / 'logs').iterdir()):
    if path.is_file() and '.running.' not in path.name:
        save(path, Path('logs') / path.name, compress=path.suffix != '.json')
        if path.suffix == '.json':
            value = json.loads(path.read_text())
            if 'exitCode' in value:
                checks.append(value)

for path in sorted(task.iterdir()):
    if not path.is_file() or path.name.startswith('agent-browser-') or path.name.endswith('-draft.md'):
        continue
    save(path, Path('receipts') / path.name,
         compress=path.suffix in {'.log', '.diff', '.lock', '.mjs'} or path.stat().st_size > 65536)
for path in sorted((task / 'scripts').iterdir()):
    if path.is_file():
        save(path, Path('collector') / path.name)
for name in ['security-osv-final','security-osv-final-r2']:
    for path in sorted((task / name).iterdir()):
        if path.is_file():
            save(path, Path(name) / path.name, compress=path.stat().st_size > 65536)

integration = []
export_verification = []
dbs = [task / 'empty-query-final.sqlite']
for directory in sorted(task.iterdir()):
    if not directory.is_dir() or not directory.name.startswith('browser-'):
        continue
    evidence = directory / 'evidence'
    if not evidence.is_dir():
        continue
    for path in sorted(evidence.rglob('*')):
        if path.is_file():
            save(path, Path('browser') / directory.name / 'evidence' / path.relative_to(evidence),
                 compress=path.suffix in {'.log', '.txt', '.ndjson', '.adi'} or
                 (path.suffix == '.json' and path.stat().st_size > 65536))
    for path in sorted((directory / 'exports').glob('*')):
        if path.is_file():
            save(path, Path('browser') / directory.name / 'exports' / path.name, compress=True)
    if (evidence / 'acceptance.json').is_file():
        value = json.loads((evidence / 'acceptance.json').read_text())
        if value.get('ok') and directory.name.startswith('browser-final-'):
            for item in value.get('exports', []):
                export = directory / 'exports' / item.get('path', item.get('filename'))
                raw = export.read_bytes()
                assert len(raw) == item.get('size', item.get('byteLength')) and hashlib.sha256(raw).hexdigest() == item['sha256'], export
                export_verification.append({'path': str(export), 'bytes': len(raw), 'sha256': item['sha256'], 'matchesReceipt': True})
        row = {'directory': directory.name, 'ok': value.get('ok'),
               'failure': value.get('failure'), 'boundary': value.get('boundary'),
               'cases': len(value.get('cases', [])),
               'exportAssertions': value.get('exportAssertions'),
               'exports': len(value.get('exports', [])),
               'protectedDatabaseMetadataUnchanged': value.get('protectedDatabaseMetadataUnchanged')}
        integration.append(row)
    if directory.name.startswith('browser-final-') and '-probe-' not in directory.name:
        dbs += sorted(directory.rglob('*.sqlite'))

process = root / '.build/phase5-20261029/process-post-roots'
for base in [task, root / '.build/phase5-20261029']:
    for attempt in sorted(base.glob('process-*')):
        if attempt == process or not attempt.is_dir():
            continue
        for path in sorted((attempt / 'evidence').glob('*')):
            if path.is_file() and path.suffix not in {'.sqlite','.db'}:
                label = ('scratch-' if base == task else 'canonical-') + attempt.name
                save(path, Path('process-attempts') / label / path.name,
                     compress=path.suffix in {'.log','.ndjson','.adi'} or path.stat().st_size > 65536)
for path in sorted((process / 'evidence').iterdir()):
    if path.is_file():
        save(path, Path('current-process') / path.name, compress=path.suffix in {'.ndjson','.log','.adi'} or path.stat().st_size > 65536)
value = json.loads((process / 'evidence/acceptance.json').read_text())
assert value['outcome'] == {'ok': True}, value['outcome']
assert value['operationCount'] == 78
assert all(value['assertions'].values())
for item in value['contestMutation']['exportChecks']:
    suffix = '.adi' if item['format'] == 'adif' else '.log'
    candidates = list((process / 'evidence').glob(item['plugin'] + '-*' + suffix))
    assert len(candidates) == 1, candidates
    raw = candidates[0].read_bytes()
    assert len(raw) == item['bytes'] and hashlib.sha256(raw).hexdigest() == item['sha256'], item
    export_verification.append({'path': str(candidates[0]), 'bytes': len(raw), 'sha256': item['sha256'], 'matchesReceipt': True})
dbs += sorted((process / 'private-root').rglob('*.sqlite'))
# Restrict even unusual fixture layouts to the task-owned output, never user storage.
for path in process.rglob('*.sqlite'):
    if 'bootstrap' not in path.parts and path not in dbs:
        dbs.append(path)

integrity = []
for path in dbs:
    assert path.is_file(), path
    assert path.is_relative_to(task) or path.is_relative_to(process), path
    with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
        check = [r[0] for r in db.execute('pragma integrity_check')]
        foreign = db.execute('pragma foreign_key_check').fetchall()
        tables = [r[0] for r in db.execute("select name from sqlite_master where type='table' order by name")]
        version = db.execute('pragma user_version').fetchone()[0]
        counts = {name: db.execute('select count(*) from "' + name.replace('"','""') + '"').fetchone()[0]
                  for name in tables if name.lower() in ['qsos','qso','contacts','contest_contacts','qso_log','dxlog']}
    assert check == ['ok'] and not foreign, (path,check,foreign)
    integrity.append({'path': str(path), 'integrityCheck': check, 'foreignKeyCheck': foreign,
                      'userVersion': version, 'tables': tables, 'selectedRowCounts': counts})

readiness = json.loads((task / 'final-all-contests-post-roots.json').read_text())
statuses = Counter(v['status'] for p in readiness['plugins'] for v in p['checks'].values())
summary = {'recordedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'sourceHead': head, 'commands': len(checks),
           'commandExits': dict(Counter(str(x['exitCode']) for x in checks)),
           'readiness': {'plugins': readiness['catalogueCount'], 'checks': dict(statuses)},
           'browserRuns': integration,
           'process': {k: value[k] for k in ['outcome','operationCount','assertions','boundary']},
           'databaseChecks': len(integrity)}
mandatory = ['STABLE-FRONTEND','STABLE-PYTHON','STABLE-PORTABLE',
             'STABLE-NATIVE','STABLE-RUST','STABLE-RUST-FEATURE',
             'STABLE-NPM-CI','STABLE-FRONTEND-BUILD','STABLE-NPM-AUDIT',
             'STABLE-CLIPPY','STABLE-STRICT-CONFIRM','STABLE-NATIVE-RELEASE-CONFIRM',
             'STABLE-RUST-RELEASE','STABLE-WORKER-BUILD','STABLE-PROCESS','STABLE-PROTOCOL',
             'STABLE-CATALOGUE','STABLE-OSV','ITER8-ROOTS-POLICY-TESTS','ITER8-ROOTS-POSITIVE',
             'FINAL-CLEAN-NPM-CI','FINAL-CLEAN-FRONTEND-BUILD','FINAL-STRICT-SWIFT',
             'FINAL-NATIVE-RELEASE','FINAL-RUST-RELEASE','FINAL-WORKER-BUILD',
             'FINAL-CLIPPY','ITER6-NODE-CHECKS','ITER6-RELOCATION-TESTS',
             'FINAL-PROCESS-ENGINE','FINAL-WORKER-PROTOCOL','FINAL-TSAN',
             'FINAL-CONTESTS','FINAL-GENERATOR','FINAL-CORPUS',
             'FINAL-BROWSER-OPERATOR','FINAL-BROWSER-FAMILY','FINAL-BROWSER-DECLARATIVE',
             'FINAL-BROWSER-NAQP','FINAL-BROWSER-SCP-R3','FINAL-LIVE-SCP','FINAL-LIVE-PUBLIC',
             'FINAL-LARGE-DATA','FINAL-AWARD-LARGE','FINAL-EMPTY-QUERY',
             'FINAL-HAMLIB-SMOKE','FINAL-HAMLIB-ADAPTER','FINAL-FTP-FTPS',
             'FINAL-CW-NATIVE-CTEST','FINAL-CW-ASAN-CTEST','FINAL-CW-WIRE','FINAL-CW-NUMPY',
             'FINAL-CW-SUSTAINED','ITER5-POLICY-TESTS','ITER5-NPM-AUDIT','ITER5-OSV']
summary['finalGates'] = []
for name in mandatory:
    gate = json.loads((task / 'logs' / (name + '.json')).read_text())
    assert gate['exitCode'] == 0 and not gate['timedOut'], gate
    if name in {'STABLE-FRONTEND','STABLE-PYTHON','STABLE-PORTABLE','STABLE-NATIVE','STABLE-RUST','STABLE-RUST-FEATURE'}:
        assert gate['sourceHeadAtStart'] == head == gate['sourceHeadAtFinish']
        assert gate['sourceStatusAtStart'] == []
    summary['finalGates'].append({'id':name,'exitCode':gate['exitCode'],'durationSeconds':gate['durationSeconds']})
profile = json.loads((task / 'logs/FINAL-CW-SUSTAINED.log').read_text().splitlines()[0])
assert profile['stable_under_this_synthetic_load'] is True
assert profile['delivered_seconds'] == 60 and profile['dropped_events'] == 0
summary['cwBoundedSyntheticProfile'] = profile
(dest / 'cw-bounded-profile.json').write_text(json.dumps(profile,indent=2) + '\n')
(dest / 'results.json').write_text(json.dumps(summary,indent=2) + '\n')
(dest / 'database-integrity.json').write_text(json.dumps(integrity,indent=2) + '\n')
(dest / 'export-verification.json').write_text(json.dumps(export_verification,indent=2) + '\n')
(dest / 'raw-artifact-index.json').write_text(json.dumps(raw_records,indent=2) + '\n')

lines = ['# Phase 5 command ledger', '',
         'Actual UTC receipts and raw output. Expected negative controls and resolved failed iterations remain failures in this ledger. The report explains their disposition. Gzip files preserve original bytes, including ADIF/Cabrillo line endings. Older receipts lack per-command source fields; the report records the exact component-equivalence boundary rather than inventing them.', '',
         '| ID | Exit | Seconds | Started UTC |', '| --- | ---: | ---: | --- |']
for v in sorted(checks,key=lambda x:x['startedUTC']):
    lines.append(f"| {v['id']} | {v['exitCode']} | {v['durationSeconds']} | {v['startedUTC']} |")
lines += ['', '## Exact commands', '']
for v in sorted(checks,key=lambda x:x['startedUTC']):
    lines += ['### '+v['id'], '', 'Working directory: `'+v['cwd']+'`.', '', '```sh',
              shlex.join(v['command']), '```', '',
              f"Exit {v['exitCode']}; timeout={v['timedOut']}. [Receipt](logs/{v['id']}.json), [raw output](logs/{v['id']}.log.gz).", '']
(dest / 'COMMANDS.md').write_text('\n'.join(lines))
print(json.dumps(summary,default=str))
