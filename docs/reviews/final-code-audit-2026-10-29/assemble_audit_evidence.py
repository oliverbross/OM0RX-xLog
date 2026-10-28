import datetime
import gzip
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
TASK = pathlib.Path('/tmp/xlog-phase6-20261029-0ce97a12')
DEST = ROOT / 'docs/reviews/final-code-audit-2026-10-29'
HEAD = '0ce97a12bb06f1fb7c501c3f1286ae9bb1aca450'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + '\n')

assert not DEST.exists(), 'Never overwrite an earlier audit archive'
assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == HEAD
assert not subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip()
baseline = json.loads((TASK / 'baseline-source-sha256.json').read_text())
assert isinstance(baseline, dict)
changed = json.loads((TASK / 'changed-inputs.json').read_text())
failures = [name for name, sha in baseline.items() if digest((ROOT / name).read_bytes()) != sha]
assert not failures, failures

root_changed = [
    {'file': 'prototype/scripts/accept-contesting-worker-process.mjs', 'ranges': ['1-541'],
     'functions': ['WorkerProcess constructor/start/call/close and lifecycle helpers', 'main acceptance runner, runtime/provenance/fixture helpers'],
     'depth': 'Complete source, including changed bodies/callers; actual historical current-scenario ledger challenged independently; FA-007'},
    {'file': 'prototype/scripts/contesting-worker-current-scenario.mjs', 'ranges': ['1-171'],
     'functions': ['runCurrentContestScenario and nested request/response/mutation helpers'],
     'depth': 'Complete source and actual prior 78-operation ledger; no new process acceptance run'},
    {'file': 'prototype/scripts/relocate-contest-python.py', 'ranges': ['1-372'],
     'functions': ['packaging_source_names', 'validated_bundle_target', 'main and closure/CA/loader/self-test helpers'],
     'depth': 'Complete source, changed function bodies and callers; 12 fresh relocation/provenance cases pass'},
    {'file': 'prototype/scripts/test-contest-python-relocation.py', 'ranges': ['1-190'],
     'depth': 'Complete source and 12 actual cases freshly executed'},
    {'file': 'prototype/scripts/accept-contest-naqp-operator-browser.mjs', 'ranges': ['1-447'],
     'functions': ['select', 'click', 'createNAQPCase', 'acceptance runner and all call sites'],
     'depth': 'Complete source, changed browser interactions/oracles and callers; no browser execution'},
    {'file': 'tools/check_reviewed_security_patches.py', 'ranges': ['1-49'],
     'depth': 'Complete policy implementation and current four lock floors; seven fresh unit tests pass'},
    {'file': 'python/tests/test_reviewed_security_patches.py', 'ranges': ['1-44'],
     'depth': 'Complete test bodies; seven fresh cases pass'},
    {'file': 'tools/check_portable_iq_sources.py', 'ranges': ['1-61'],
     'depth': 'Complete manifest-derived slice guard; actual source slice freshly compiled by radio reviewer'},
    {'file': '.github/workflows/contest-portability.yml', 'ranges': ['changed diff', '317-415'],
     'depth': 'Changed CI generation/discovery/execution and guard wiring read; no fresh CI execution'},
    {'file': 'prototype/src-tauri/Cargo.lock', 'ranges': ['complete remediation-range diff'],
     'depth': 'Four reviewed version patches and existing-edge resolution diff read; no entire dependency implementation audit'},
    {'file': 'prototype/src-tauri/src/main.rs', 'ranges': ['changed module declaration', '2068-2089', '2200-2310', '2384-2494', '2620-2805', '4250-4405'],
     'depth': 'Changed durable_file declaration plus typed request admission, role gate, selection/active routing, raw action rejection, module-switch and ordinary Quit caller paths'},
]
root_additional = {
    'Sources/XLogApp/AppModel.swift': ['910-950', '1090-1178', '1625-1660'],
    'Sources/XLogApp/SettingsView.swift': ['445-496'],
    'Sources/XLogCore/SyncEngine.swift': ['1-118', '245-430', '550-568'],
    'Sources/XLogCore/BackupManager.swift': ['306-353', '521-557'],
    'Sources/XLogCore/LogbookDatabase.swift': ['531-555', '3133-3182', '3301-3344'],
    'Sources/XLogPrototypeSupport/LiveLogbookMethods.swift': ['1460-1492'],
    'Sources/XLogPrototypeSupport/Contesting/PythonContestLane.swift': ['439-482'],
    'python/contest_host/host.py': ['2394-2448', '2524-2555'],
    'Sources/XLogPrototypeSupport/LiveWorker.swift': ['370-460', '555-597'],
    'Sources/XLogPrototypeSupport/LiveStationMethods.swift': ['1-150'],
    'Sources/XLogPrototypeSupport/NativeDraftPowerGate.swift': ['1-174'],
    'Sources/XLogPrototypeSupport/LiveFlexSession.swift': ['173-265'],
    'prototype/src-tauri/src/worker.rs': ['1-190', '638-775', '1010-1056', '1902-1922'],
    'prototype/src-tauri/src/radio_slots.rs': ['1-205'],
    'prototype/src-tauri/src/station_selection.rs': ['1-165', '205-238', '408-451'],
    'prototype/src-tauri/src/manual_tune.rs': ['45-160'],
    'prototype/src/live/DetachedQSOSurface.tsx': ['1-36', '120-203'],
    'prototype/src/live/useDuplicateContact.ts': ['1-38'],
    'Package.swift': ['complete manifest'],
    'prototype/package.json': ['complete manifest'],
    'prototype/src-tauri/Cargo.toml': ['complete manifest'],
    'prototype/src-tauri/tauri.conf.json': ['complete configuration'],
}
coverage = {
    'sourceHead': HEAD,
    'diffBase': '530de4c4e4b23281ec60585cc7a2e5ca011476fb',
    'changedInputCount': len(changed),
    'trackedPreservedInputs': len(baseline),
    'rootChangedCoverage': root_changed,
    'rootAdditionalRanges': root_additional,
    'architectureInventory': '71 native Rust module files inventoried; entrypoints/manifests and critical boundary paths reviewed. Not all module implementations fully read.',
    'releaseCriteriaSources': ['AGENTS.md', 'docs/DEVELOPMENT_WORKFLOW.md', 'docs/P1_RUNTIME_ACCEPTANCE.md', 'docs/P1_RUNTIME_PACKAGING_GAPS.md', 'docs/planning/WAVE4_CONNECTED_OPERATION_ACCEPTANCE_2026-10-27.md'],
    'priorReportsRead': ['CODE_REVIEW.md', 'REVIEW_COVERAGE.md', 'REMEDIATION_TRACKER.md', 'REGRESSION_TEST_REPORT.md', 'STABILITY_REPORT.md'],
    'limits': [
        'Every assigned changed production function body read; named callers, safeguards and test oracles challenged. Full body reading does not certify every behavior or callee.',
        'Changed tests reviewed through their changed bodies/oracles and relevant fixture setup, not all historical tests in large files.',
        'Untouched application source, all migrations/outbox/provider behavior, large UI child components and third-party implementations remain partial.',
        'No new whole-app build/full suite, sanitizer, memory soak, live network/radio/provider/native UI or platform runtime acceptance.',
        'No application/test/configuration edits; only final audit and evidence archive are authorized outputs.'
    ],
}
write_json(TASK / 'root-coverage.json', coverage)
env = {
    'observedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'sourceHead': HEAD,
    'uname -mrs': 'Darwin 27.0.0 arm64',
    'swift --version': 'Apple Swift version 6.4 (swiftlang-6.4.0.34.1 clang-2100.3.34.1); target arm64-apple-macosx27.0.0; driver 1.168.6',
    'node --version': 'v24.11.1',
    'python3.12 --version': 'Python 3.12.4',
    'rustc --version': 'rustc 1.98.0 (88d9e12ae 2026-08-18) (Homebrew)',
    'boundaries': 'Version commands observed anew; no fresh full Rust compile. sw_vers-containing environment batch was rejected before any segment; sw_vers not retried or bypassed. These standalone allowed independent version commands were used.'
}
write_json(TASK / 'environment.json', env)

owners = {}
for agent, key in [('frontend', 'changed_functions'), ('persistence', 'changedProductionFunctions'), ('radio', 'changedFileCoverage')]:
    data = json.loads((TASK / 'agents' / agent / 'coverage.json').read_text())
    for record in data[key]:
        owners.setdefault(record['file'], set()).add(agent)
    if agent == 'frontend':
        for record in data['changed_non_function_items']:
            owners.setdefault(record['file'], set()).add(agent)
for record in root_changed:
    owners.setdefault(record['file'], set()).add('root')
tests = {
    'frontend': ['prototype/src/contesting/ContestOperatorPanel.test.tsx', 'prototype/src/contesting/ContestWorkspace.arrlDX.test.tsx', 'prototype/src/live/DetachedQSOSurface.test.tsx', 'prototype/src/live/OperatorDraftTime.test.tsx', 'prototype/src/live/QSOEditorPower.test.tsx', 'prototype/src/live/adifTransfer.schema.test.ts', 'prototype/src/live/adifTransfer.test.ts', 'prototype/tests/fixtures/adx317.README.md', 'prototype/tests/fixtures/adx317.xsd.gz'],
    'persistence': ['Tests/XLogPrototypeTests/LegacyADIFTransferTests.swift', 'Tests/XLogPrototypeTests/OperatorDraftTests.swift', 'python/tests/test_recorder.py', 'python/tests/test_remediation_import_replica.py', 'python/tests/test_remediation_wae.py', 'python/tests/test_wave5_developer_host.py'],
    'radio': ['Tests/XCWCoreTests/CWComputeWirePrimitiveTests.swift', 'Tests/XLogPrototypeTests/LiveClusterMethodsTests.swift', 'Tests/XLogPrototypeTests/LiveFldigiBridgeTests.swift', 'Tests/XLogPrototypeTests/LiveOpportunitiesMethodsTests.swift', 'Tests/XLogPrototypeTests/LiveTCISessionTests.swift', 'Tests/XLogPrototypeTests/StationRadioRegistryTests.swift'],
}
for agent, files in tests.items():
    for name in files:
        owners.setdefault(name, set()).add(agent)
missing = [name for name in changed if name not in owners]
assert not missing, missing
write_json(TASK / 'changed-input-coverage.json', [
    {'file': name, 'sha256': baseline[name], 'reviewers': sorted(owners[name]),
     'depth': ('Changed test/fixture bodies, oracles and relevant setup inspected; execution scope in reviewer ledger' if '/Tests/' in '/' + name or '/tests/' in '/' + name or '.test.' in name else
               'Changed functions/declarations reviewed with named callers and safeguards; exact depth and remaining file ranges in reviewer ledger'),
     'ledger': ['root-coverage.json' if owner == 'root' else 'agents/' + owner + '/coverage.json' for owner in sorted(owners[name])]} for name in changed])

DEST.mkdir(parents=True)
top = ['baseline.json', 'baseline-source-sha256.json', 'changed-inputs.json', 'changed-input-coverage.json', 'root-coverage.json', 'environment.json', 'root-helper-checks.json']
selected = [TASK / name for name in top]
selected += list((TASK / 'proofs').rglob('*.json'))
suffixes = {'.md', '.json', '.txt', '.log', '.py', '.swift', '.tsx', '.ts', '.mjs', '.diff', '.rs'}
for path in (TASK / 'agents').rglob('*'):
    rel = path.relative_to(TASK)
    if path.is_symlink() or not path.is_file() or path.suffix not in suffixes:
        continue
    if any(part in {'build', '.build', 'runtime', 'node_modules'} for part in rel.parts):
        continue
    if 'portable-iq' in rel.parts and path.name not in {'result.json', 'swift-test.log', 'Package.swift'}:
        continue
    selected.append(path)
selected.append(TASK / 'assemble_audit_evidence.py')
index = []
for source in sorted(set(selected)):
    rel = source.relative_to(TASK)
    data = source.read_bytes()
    # Raw log/proof/snapshot bytes stay exact, including original final newlines.
    compress = source.suffix in {'.log', '.swift', '.tsx', '.ts', '.diff', '.rs', '.txt'}
    target = DEST / (str(rel) + '.gz' if compress else str(rel))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(gzip.compress(data, mtime=0) if compress else data)
    index.append({'originalScratchPath': str(source), 'archive': str(target.relative_to(DEST)),
                  'originalBytes': len(data), 'originalSHA256': digest(data),
                  'archiveBytes': target.stat().st_size, 'archiveSHA256': digest(target.read_bytes()),
                  'compression': 'gzip; exact original bytes' if compress else 'none'})
write_json(DEST / 'artifact-index.json', index)
write_json(DEST / 'source-preservation.json', {
    'observedUTC': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'auditedSourceHead': HEAD, 'trackedInputs': len(baseline), 'mismatches': failures,
    'repositoryWasCleanBeforeArchive': True,
    'verification': 'Every preserved input rehashed before any audit/report repository write; final validation repeats the comparison.',
    'exclusions': 'No binary, SQLite/sidecar, dependency symlink, runtime fixture directory or Swift build tree archived.'
})
print(json.dumps({'archive': str(DEST), 'artifacts': len(index), 'bytes': sum(x['archiveBytes'] for x in index), 'changedInputsAccountedFor': len(changed), 'preservedInputs': len(baseline)}, indent=2))
