"""Shared bounded Phase 5 evidence helpers. No work happens at import time."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess

ROOT = Path('/Users/oliver/Documents/Projects/OM0RX-xLog')
TASK = Path('/tmp/xlog-phase5-20261029-721e0705')
TEXT_SUFFIXES = {'.json', '.txt', '.md', '.log', '.diff', '.lock', '.mjs', '.py',
                 '.toml', '.swift', '.rs', '.yml', '.yaml', '.csv', '.ts', '.sh',
                 '.plist', '.ndjson', '.adi', '.cabrillo'}
MEDIA_SUFFIXES = {'.png', '.jpg', '.jpeg', '.webp', '.webm', '.mp4'}
DB_SUFFIXES = {'.sqlite', '.sqlite3', '.db'}

def read_json(path):
    return json.loads(Path(path).read_text())

def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def parse_plan():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', type=Path, default=TASK / 'final-validation-plan.json')
    args = parser.parse_args()
    plan = read_json(args.plan)
    assert re.fullmatch(r'[0-9a-f]{40}', plan['head']), plan['head']
    assert plan.get('root', str(ROOT)) == str(ROOT)
    assert plan.get('task', str(TASK)) == str(TASK)
    plan['_planPath'] = str(args.plan.resolve())
    return plan

def within(path, roots):
    resolved = Path(path).resolve(strict=True)
    assert any(resolved.is_relative_to(Path(root).resolve(strict=True)) for root in roots), path
    return resolved

def source_snapshot(plan):
    snapshot_path = within(plan['sourceSnapshot'], [TASK])
    snapshot = read_json(snapshot_path)
    assert snapshot and isinstance(snapshot, dict)
    assert len(snapshot) == plan.get('sourceFileCount', 1829), ('Unexpected compiled-input population', len(snapshot))
    for required in ['Sources/XCWCore/CWComputeWire.swift',
                     'Tests/XCWCoreTests/CWComputeWirePrimitiveTests.swift',
                     'Tests/XLogPrototypeTests/LiveClusterMethodsTests.swift',
                     'prototype/src-tauri/src/durable_file.rs', 'tools/check_portable_iq_sources.py']:
        assert required in snapshot, ('Current repair missing from source snapshot', required)
    for relative, expected in snapshot.items():
        assert re.fullmatch(r'[0-9a-f]{64}', expected), relative
        path = ROOT / relative
        assert not Path(relative).is_absolute() and '..' not in Path(relative).parts, relative
        within(path, [ROOT])
        assert sha(path) == expected, relative
    return snapshot

def assert_head(plan):
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    assert actual == plan['head'], (actual, plan['head'])

def receipt(name):
    assert re.fullmatch(r'[A-Za-z0-9_-]+', name), name
    value = read_json(TASK / 'logs' / (name + '.json'))
    assert value['id'] == name, value
    assert value.get('finishedUTC') and value.get('exitCode') is not None, value
    return value

def successful(name, head=None):
    value = receipt(name)
    assert value['exitCode'] == 0 and value['timedOut'] is False, value
    if head is not None:
        assert value.get('sourceHeadAtStart') == head == value.get('sourceHeadAtFinish'), value
        assert value.get('sourceStatusAtStart') == [], value
    return value

def assert_gates(plan):
    required = plan['finalGateIds']
    assert required and len(required) == len(set(required)), required
    current = [successful(name, plan['head']) for name in required]
    for name in plan.get('retainedIntegrationGates', []):
        successful(name)
    for name in plan['suiteIds'].values():
        assert name in required, ('Suite missing current-head gate', name)
    return current

def is_database(path):
    name = Path(path).name.lower()
    return Path(path).suffix.lower() in DB_SUFFIXES or any(
        name.endswith(suffix + tail) for suffix in DB_SUFFIXES for tail in ('-wal', '-shm', '-journal'))

def evidence_file(path, media=False):
    """Positive suffix policy plus binary signatures; a suffix is never sufficient."""
    path = Path(path)
    if path.is_symlink() or not path.is_file() or is_database(path):
        return False
    if path.suffix.lower() not in TEXT_SUFFIXES | (MEDIA_SUFFIXES if media else set()):
        return False
    with path.open('rb') as stream:
        prefix = stream.read(512)
    if prefix.startswith((b'SQLite format 3\0', b'\x7fELF', b'MZ', b'\xfe\xed\xfa', b'\xcf\xfa\xed\xfe', b'\xca\xfe\xba\xbe')):
        return False
    if path.suffix.lower() in TEXT_SUFFIXES and b'\0' in prefix:
        return False
    return True

def log_text(name):
    raw = (TASK / 'logs' / (name + '.log')).read_text(errors='replace')
    return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', raw)

def swift_count(text):
    xctest = [int(value) for value in re.findall(
        r"Test Suite 'All tests' passed[^\n]*\n\s*Executed (\d+) tests?", text)]
    testing = [int(value) for value in re.findall(r'Test run with (\d+) tests? in \d+ suites? passed', text)]
    assert xctest and testing, 'No complete Swift test summaries'
    return {'xctest': sum(xctest), 'swiftTestingSummary': sum(testing)}, {'xctestRuns': xctest, 'swiftTestingRuns': testing}

def suite_counts(plan):
    ids = plan['suiteIds']
    expected = plan['suiteCounts']
    actual = {}
    details = {}
    for key in ['nativeSwift', 'portableSwift']:
        actual[key], details[key] = swift_count(log_text(ids[key]))
    front = log_text(ids['frontend'])
    files = re.findall(r'Test Files\s+(\d+) passed', front)
    tests = re.findall(r'Tests\s+(\d+) passed', front)
    node = re.findall(r'^(?:#|ℹ) tests (\d+)\s*$', front, re.MULTILINE)
    assert len(files) == len(tests) == 1 and node, 'Incomplete or repeated frontend summary'
    actual['frontend'] = {'vitest': int(tests[0]), 'files': int(files[0]), 'node': sum(map(int, node))}
    python = re.findall(r'Ran (\d+) tests? in ', log_text(ids['python']))
    assert len(python) == 1, python
    actual['python'] = int(python[0])
    default = re.findall(r'test result: ok\. (\d+) passed; 0 failed', log_text(ids['rustDefault']))
    feature = re.findall(r'test result: ok\. (\d+) passed; 0 failed', log_text(ids['rustContestingFeature']))
    assert len(default) >= 2 and len(feature) >= 1, (default, feature)
    actual['rustDefault'] = {'unit': int(default[0]), 'integrationFunctions': int(default[1])}
    actual['rustContestingFeature'] = int(feature[0])
    assert actual == expected, {'actual': actual, 'expected': expected}
    return actual, details

def verify_worker(plan):
    path = within(plan['workerManifest'], [TASK])
    manifest = read_json(path)
    assert manifest['sourceHead'] == manifest['sourceHeadAfterBuild'] == plan['head'], manifest
    assert manifest['compiledInputsClean'] is True
    worker = manifest['worker']
    binary = within(worker['path'], [ROOT / '.build/phase5-20261029'])
    assert binary.stat().st_size == worker['size'] and sha(binary) == worker['sha256']
    for item in manifest.get('resources', {}).values():
        resource_root = within(item['path'], [ROOT / '.build/phase5-20261029'])
        for resource in item.get('files', []):
            resource_path = within(resource_root / resource['path'], [resource_root])
            assert resource_path.stat().st_size == resource['size'] and sha(resource_path) == resource['sha256']
    return manifest

def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')
