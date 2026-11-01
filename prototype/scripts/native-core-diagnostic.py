#!/usr/bin/env python3
"""Run native-core diagnostics with literal filter forwarding and execution evidence."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid


ANSI = re.compile(r'\x1b\[[0-?]*[ -/]*[@-~]')
XCTEST = re.compile(r"^Test Case (.+) (passed|failed) \(")
SWIFT_TESTING = re.compile(r'^[✔✓√×✘] Test (?!run with\b)(.+) (passed|failed) after [\d.]+ seconds?\b')


def completion(line):
    clean = ANSI.sub('', line).strip()
    match = XCTEST.search(clean) or SWIFT_TESTING.search(clean)
    return {'name': match[1], 'outcome': match[2]} if match else None


def run_diagnostic(command, selected_filter, root):
    record = {'schema': 1, 'sourceCommit': os.environ.get('GITHUB_SHA'), 'started': time.time(),
              'scope': 'filtered-native-core' if selected_filter else 'unfiltered-native-core',
              'filter': selected_filter, 'fullProductQualification': False, 'completedTests': []}
    result = 1
    try:
        if '\0' in selected_filter or len(selected_filter) > 4096:
            raise ValueError('The native test filter must be a bounded string without NUL bytes.')
        if any(value == '--filter' or value.startswith('--filter=') for value in command):
            raise ValueError('Select tests only through the diagnostic test_filter input.')
        arguments = [*command, *(['--filter', selected_filter] if selected_filter else [])]
        record['command'] = arguments
        with subprocess.Popen(arguments, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                              text=True, encoding='utf-8', errors='replace') as child:
            for line in child.stdout:
                print(line, end='', flush=True)
                observed = completion(line)
                if observed is not None:
                    record['completedTests'].append(observed)
            result = child.wait()
        record['childExitCode'] = result
        if selected_filter and not record['completedTests']:
            raise RuntimeError('The filter produced no non-skipped test completion records; this diagnostic does not qualify.')
        if result == 0 and any(test['outcome'] == 'failed' for test in record['completedTests']):
            raise RuntimeError('A failed test completion was reported despite a zero command exit code.')
        record['state'] = 'passed' if result == 0 else 'failed'
    except Exception as error:
        record.update(state='failed', error=str(error))
        result = result or 1
    record.update(finished=time.time(), exitCode=result, actualCompletedTestRecords=len(record['completedTests']))
    directory = root / '.build/native-core-diagnostics'
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / (str(uuid.uuid4()) + '.json')
    with target.open('x', encoding='utf-8') as output:
        json.dump(record, output, indent=2)
        output.write('\n')
    print(json.dumps({'nativeCoreDiagnostic': record['state'], 'scope': record['scope'],
                      'actualCompletedTestRecords': record['actualCompletedTestRecords'],
                      'receipt': str(target), **({'error': record['error']} if 'error' in record else {})}), flush=True)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as output:
            output.write('\n### Native core diagnostic\n\n'
                         f"Scope: {record['scope']}. Result: {record['state']}. "
                         f"Non-skipped test completion records: {record['actualCompletedTestRecords']}.\n\n"
                         'The exact filter and completed test names are retained in the diagnostic receipt. '
                         'A filtered run qualifies only that observed subset; package, installer and full-product gates remain required.\n')
    return result


def main():
    # GitHub's Windows pipe can default to a legacy codepage. Swift Testing
    # emits UTF-8 markers/names; relay them without changing the child result.
    sys.stdout.reconfigure(encoding='utf-8')
    if len(sys.argv) < 3 or sys.argv[1] != '--':
        raise SystemExit('Usage: native-core-diagnostic.py -- <native test command>')
    return run_diagnostic(sys.argv[2:], os.environ.get('XLOG_SWIFT_TEST_FILTER', ''), Path(__file__).resolve().parents[2])


if __name__ == '__main__':
    sys.exit(main())
