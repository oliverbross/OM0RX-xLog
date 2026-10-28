"""Archive bounded evidence after the explicit final-validation plan is satisfied."""
from collections import Counter
from pathlib import Path
import datetime
import gzip
import hashlib
import json
import shlex
import sqlite3
from collector_common import (ROOT, TASK, assert_gates, assert_head, evidence_file,
                              parse_plan, read_json, sha, source_snapshot,
                              suite_counts, verify_worker, within, write_json)

def main():
    plan = parse_plan()
    assert plan.get('archiveQuiescent') is True, 'Parent must confirm all evidence writers finished'
    assert_head(plan)
    source = source_snapshot(plan)
    final_gates = assert_gates(plan)
    counts, count_details = suite_counts(plan)
    worker_manifest = verify_worker(plan)
    restoration = read_json(TASK / 'restoration-final.json')
    assert restoration['originalDistFiles'] == 180 and restoration['originalDistHashesMatch'] is True
    assert restoration['finalSourceFilesVerified'] == len(source)
    dest = ROOT / 'docs/reviews/stability-2026-10-29'
    assert not dest.exists(), dest
    if plan.get('requireAllDurableCommandsComplete', True):
        for path in (TASK / 'logs').glob('*.running.json'):
            completed = path.with_name(path.name.replace('.running.json', '.json'))
            assert completed.exists() and read_json(completed).get('finishedUTC'), ('Unfinished durable command', path)
    process = within(plan['currentProcessRoot'], [ROOT / '.build/phase5-20261029'])
    value = read_json(process / 'evidence/acceptance.json')
    assert value['outcome'] == {'ok': True}, value['outcome']
    assert value['operationCount'] == 78 and all(value['assertions'].values())
    assert value['source']['expectedHead'] == value['source']['observedHead'] == plan['head']
    assert value['source']['buildManifest'] == worker_manifest
    assert value['source']['buildManifestSha256'] == sha(plan['workerManifest'])
    assert value['source']['currentScenario']['unchanged'] is True
    assert value['paths']['outputRoot'] == str(process)
    assert len(value['processes']) == 2 and all(item['exit'] == {'code': 0, 'signal': None} for item in value['processes'])
    readiness = read_json(within(plan['readinessPath'], [TASK]))
    dest.mkdir(parents=True)
    raw_records = []
    omitted = []

    def save(path, relative, compress=False, media=False):
        path = Path(path)
        # Validate resolved ancestors too; a symlinked evidence directory must not
        # turn a task-only collection into an external/user-storage read.
        within(path, [TASK, ROOT / '.build/phase5-20261029'])
        if not evidence_file(path, media=media):
            omitted.append(str(path))
            return
        relative = Path(relative)
        assert not relative.is_absolute() and '..' not in relative.parts, relative
        data = path.read_bytes()
        if compress:
            relative = Path(str(relative) + '.gz')
        target = dest / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        assert not target.exists(), target
        target.write_bytes(gzip.compress(data, mtime=0) if compress else data)
        raw_records.append({'source': str(path), 'archive': str(relative), 'rawBytes': len(data),
                            'rawSHA256': hashlib.sha256(data).hexdigest(), 'gzip': compress})

    checks = []
    for path in sorted((TASK / 'logs').iterdir()):
        if not path.is_file() or '.running.' in path.name:
            continue
        if path.suffix == '.json':
            receipt = read_json(path)
            if 'exitCode' in receipt:
                assert receipt['exitCode'] is not None and receipt.get('finishedUTC'), path
                checks.append(receipt)
        save(path, Path('logs') / path.name, compress=path.suffix != '.json')

    # Positive suffix policy rejects executable/databases even if an accidental name looks textual.
    excluded_task_names = {'agent-state.json'}
    for path in sorted(TASK.iterdir()):
        if (not path.is_file() or path.name in excluded_task_names or
                path.name.startswith('agent-browser-') or 'draft' in path.name.lower() or
                'checkpoint' in path.name.lower()):
            continue
        if path.name == 'remote-ci-final.json':
            # Retain the old snapshot as dated/source-labelled history, never as
            # the apparent final CI status for the new application head.
            prior_ci = read_json(path)
            prior_head = prior_ci.get('sourceHead')
            assert isinstance(prior_head, str) and len(prior_head) == 40
            save(path, Path('ci/historical') / prior_head / path.name)
            continue
        save(path, Path('receipts') / path.name,
             compress=path.suffix in {'.log', '.diff', '.lock', '.mjs'} or path.stat().st_size > 65536)
    ci_index = []
    ci_directory = TASK / 'logs/agent-ci'
    if ci_directory.is_dir():
        for path in sorted(ci_directory.iterdir()):
            if not path.is_file() or '.running.' in path.name:
                continue
            if path.name == 'latest-status.json':
                metadata = read_json(path)
                assert metadata['sourceHead'] == plan['head'], ('Stale current CI metadata', metadata)
                relative = Path('ci/current') / path.name
                ci_index.append({'archive': str(relative), 'kind': 'current-source snapshot',
                                 'sourceHead': metadata['sourceHead'], 'observedUTC': metadata['observedUTC']})
            else:
                relative = Path('ci/historical-monitor') / path.name
                ci_index.append({'archive': str(relative) + ('.gz' if path.suffix != '.json' else ''),
                                 'kind': 'retained earlier collection; source identity only where present in raw metadata',
                                 'sourceHead': None})
            save(path, relative, compress=path.suffix != '.json')
    (dest / 'ci').mkdir(exist_ok=True)
    write_json(dest / 'ci/chronology-index.json', ci_index)
    for label, directory in [('collector-original', TASK / 'scripts'), ('collector', Path(__file__).parent)]:
        for path in sorted(directory.iterdir()):
            if path.suffix == '.py':
                save(path, Path(label) / path.name)
    for name in plan.get('securityDirectories', []):
        directory = within(TASK / name, [TASK])
        for path in sorted(directory.rglob('*')):
            if path.is_file():
                save(path, Path(name) / path.relative_to(directory), compress=path.stat().st_size > 65536)
    for item in plan.get('additionalEvidenceDirectories', []):
        directory = within(item['path'], [TASK, ROOT / '.build/phase5-20261029'])
        label = Path(item['label'])
        assert not label.is_absolute() and '..' not in label.parts
        for path in sorted(directory.rglob('*')):
            if path.is_file():
                save(path, Path('additional') / label / path.relative_to(directory),
                     compress=path.suffix not in {'.json', '.png', '.jpg', '.webp', '.mp4', '.webm'}, media=True)

    integration = []
    exports = []
    dbs = [Path(path) for path in plan.get('privateDatabasePaths', [])]
    database_roots = [TASK, process] + [within(path, [TASK, ROOT / '.build/phase5-20261029'])
                                      for path in plan.get('knownPrivateDatabaseRoots', [])]
    for directory in sorted(TASK.glob('browser-*')):
        evidence = directory / 'evidence'
        if not directory.is_dir() or not evidence.is_dir():
            continue
        for path in sorted(evidence.rglob('*')):
            if path.is_file():
                save(path, Path('browser') / directory.name / 'evidence' / path.relative_to(evidence),
                     compress=path.suffix in {'.log', '.txt', '.ndjson', '.adi'} or
                     (path.suffix == '.json' and path.stat().st_size > 65536), media=True)
        for path in sorted((directory / 'exports').glob('*')):
            if path.is_file():
                save(path, Path('browser') / directory.name / 'exports' / path.name, compress=True)
        acceptance = evidence / 'acceptance.json'
        if acceptance.is_file():
            browser = read_json(acceptance)
            if browser.get('ok') and directory.name.startswith('browser-final-'):
                for item in browser.get('exports', []):
                    export = within(directory / 'exports' / item.get('path', item.get('filename')), [directory / 'exports'])
                    assert export.stat().st_size == item.get('size', item.get('byteLength'))
                    assert sha(export) == item['sha256']
                    exports.append({'path': str(export), 'bytes': export.stat().st_size,
                                    'sha256': item['sha256'], 'matchesReceipt': True})
            integration.append({'directory': directory.name, 'ok': browser.get('ok'),
                                'failure': browser.get('failure'), 'boundary': browser.get('boundary'),
                                'cases': len(browser.get('cases', [])),
                                'exportAssertions': browser.get('exportAssertions'),
                                'exports': len(browser.get('exports', [])),
                                'protectedDatabaseMetadataUnchanged': browser.get('protectedDatabaseMetadataUnchanged')})
        if directory.name.startswith('browser-final-') and '-probe-' not in directory.name:
            dbs.extend(sorted(directory.rglob('*.sqlite')))

    for base in [TASK, ROOT / '.build/phase5-20261029']:
        for attempt in sorted(base.glob('process-*')):
            if not attempt.is_dir() or attempt.resolve() == process:
                continue
            for path in sorted((attempt / 'evidence').rglob('*')):
                if path.is_file():
                    label = ('scratch-' if base == TASK else 'canonical-') + attempt.name
                    save(path, Path('process-attempts') / label / path.relative_to(attempt / 'evidence'),
                         compress=path.suffix in {'.log', '.ndjson', '.adi'} or path.stat().st_size > 65536)
    for path in sorted((process / 'evidence').rglob('*')):
        if path.is_file():
            save(path, Path('current-process') / path.relative_to(process / 'evidence'),
                 compress=path.suffix in {'.ndjson', '.log', '.adi'} or path.stat().st_size > 65536)
    process_exports = value['contestMutation']['exportChecks']
    assert len(process_exports) == 4, process_exports
    for item in process_exports:
        suffix = '.adi' if item['format'] == 'adif' else '.log'
        candidates = list((process / 'evidence').glob(item['plugin'] + '-*' + suffix))
        assert len(candidates) == 1, candidates
        export = within(candidates[0], [process / 'evidence'])
        assert export.stat().st_size == item['bytes'] and sha(export) == item['sha256']
        exports.append({'path': str(export), 'bytes': item['bytes'], 'sha256': item['sha256'], 'matchesReceipt': True})
    for path in process.rglob('*.sqlite'):
        if 'bootstrap' not in path.parts:
            dbs.append(path)
    integrity = []
    for path in sorted(set(dbs)):
        path = within(path, database_roots)
        with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True) as db:
            check = [row[0] for row in db.execute('pragma integrity_check')]
            foreign = db.execute('pragma foreign_key_check').fetchall()
            tables = [row[0] for row in db.execute("select name from sqlite_master where type='table' order by name")]
            version = db.execute('pragma user_version').fetchone()[0]
            row_counts = {name: db.execute('select count(*) from "' + name.replace('"', '""') + '"').fetchone()[0]
                          for name in tables if name.lower() in {'qsos', 'qso', 'contacts', 'contest_contacts', 'qso_log', 'dxlog'}}
        assert check == ['ok'] and not foreign, (path, check, foreign)
        integrity.append({'path': str(path), 'integrityCheck': check, 'foreignKeyCheck': foreign,
                          'userVersion': version, 'tables': tables, 'selectedRowCounts': row_counts})

    statuses = Counter(check['status'] for plugin in readiness['plugins'] for check in plugin['checks'].values())
    summary = {'recordedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'sourceHead': plan['head'], 'compiledSourceFiles': len(source), 'commands': len(checks),
               'commandExits': dict(Counter(str(item['exitCode']) for item in checks)),
               'readiness': {'plugins': readiness['catalogueCount'], 'checks': dict(statuses)},
               'browserRuns': integration,
               'process': {key: value[key] for key in ['outcome', 'operationCount', 'assertions', 'boundary']},
               'workerManifest': {'sourceHead': worker_manifest['sourceHead'], 'worker': worker_manifest['worker']},
               'databaseChecks': len(integrity),
               'completeSuiteCounts': counts, 'suiteCountDetails': count_details,
               'testCountBoundary': 'Overlapping execution counts/summaries; not a summed unique-test count.',
               'finalGates': [{'id': item['id'], 'exitCode': item['exitCode'],
                               'durationSeconds': item['durationSeconds'], 'sourceHead': item['sourceHeadAtStart']}
                              for item in final_gates],
               'retainedIntegrationGates': plan.get('retainedIntegrationGates', []),
               'ciEvidence': plan.get('ciEvidence', {'status': 'not supplied'})}
    profile = json.loads((TASK / 'logs/FINAL-CW-SUSTAINED.log').read_text().splitlines()[0])
    assert profile['stable_under_this_synthetic_load'] is True
    assert profile['delivered_seconds'] == 60 and profile['dropped_events'] == 0
    summary['cwBoundedSyntheticProfile'] = profile
    for name, item in [('cw-bounded-profile.json', profile), ('results.json', summary),
                       ('database-integrity.json', integrity), ('export-verification.json', exports),
                       ('raw-artifact-index.json', raw_records), ('omitted-artifacts.json', sorted(set(omitted)))]:
        write_json(dest / name, item)
    lines = ['# Phase 5 command ledger', '',
             'Actual UTC receipts and original output. Failed/negative/superseded receipts retain their actual exits. A successful log-download command does not establish the remote CI job passed. Gzip preserves original bytes.', '',
             '| ID | Exit | Seconds | Started UTC |', '| --- | ---: | ---: | --- |']
    for item in sorted(checks, key=lambda entry: entry['startedUTC']):
        lines.append(f"| {item['id']} | {item['exitCode']} | {item['durationSeconds']} | {item['startedUTC']} |")
    lines.extend(['', '## Exact commands', ''])
    for item in sorted(checks, key=lambda entry: entry['startedUTC']):
        lines.extend(['### ' + item['id'], '', 'Working directory: `' + item['cwd'] + '`.', '',
                      '```sh', shlex.join(item['command']), '```', '',
                      f"Exit {item['exitCode']}; timeout={item['timedOut']}. [Receipt](logs/{item['id']}.json), [raw output](logs/{item['id']}.log.gz).", ''])
    (dest / 'COMMANDS.md').write_text('\n'.join(lines))
    print(json.dumps({'sourceHead': plan['head'], 'rawArtifacts': len(raw_records),
                      'privateDatabasesChecked': len(integrity), 'exportsVerified': len(exports),
                      'completeSuiteCounts': counts, 'omittedArtifacts': len(omitted)}))

if __name__ == '__main__':
    main()
