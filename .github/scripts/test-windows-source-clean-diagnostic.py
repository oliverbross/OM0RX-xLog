#!/usr/bin/env python3
"""Test the embedded diagnostic with disposable Git repos, without CI dispatch."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import textwrap

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / '.github/workflows/diagnose-windows-source-clean.yml'


def run(arguments, cwd=None, env=None):
    return subprocess.run(arguments, cwd=cwd, env=env, capture_output=True, text=True, encoding='utf-8')


def main():
    os.umask(0o077)
    source = WORKFLOW.read_text(encoding='utf-8')
    helper = textwrap.dedent(source.split("          @'\n", 1)[1].split("\n          '@ |", 1)[0])
    assert helper.index('$git.status =') < helper.index('$statusPaths =') < helper.index('$files +=') < helper.index('$git.diff =')
    assert 'ref: 0b7c669663841c2e55569b0c21c76ad03805cad7' in source
    assert 'package-windows-installer.ps1' not in source and 'tauri bundle' not in source
    with tempfile.TemporaryDirectory(prefix='xlog-source-receipt-test-') as temporary:
        parent = Path(temporary)
        scripts = parent / 'scripts'
        scripts.mkdir()
        (scripts / 'helper.ps1').write_text(helper, encoding='utf-8')
        lines = source.splitlines(keepends=True)
        for index, line in enumerate(lines):
            if line.rstrip() != '        run: |':
                continue
            block = []
            for following in lines[index + 1:]:
                if following.strip() and not following.startswith('          '):
                    break
                block.append(following)
            (scripts / f'step-{index}.ps1').write_text(textwrap.dedent(''.join(block)), encoding='utf-8')
        parser = parent / 'parse.ps1'
        parser.write_text('param($Directory)\n$ErrorActionPreference="Stop"\nforeach($file in Get-ChildItem $Directory -Filter *.ps1){$tokens=$null;$errors=$null;$null=[System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors);if($errors.Count){throw ($errors|Out-String)}}\n', encoding='utf-8')
        parsed = run(['pwsh', '-NoProfile', '-File', str(parser), str(scripts)])
        assert parsed.returncode == 0, parsed.stdout + parsed.stderr
        template = parent / 'template'
        template.mkdir()
        original = b'original\n'
        (template / 'tracked.txt').write_bytes(original)
        for command in (['git', 'init', '--quiet'], ['git', 'config', 'core.autocrlf', 'false'],
                        ['git', 'add', 'tracked.txt'], ['git', '-c', 'user.name=Diagnostic Fixture', '-c',
                        'user.email=diagnostic@example.invalid', 'commit', '--quiet', '-m', 'fixture']):
            result = run(command, template)
            assert result.returncode == 0, result.stderr
        head = run(['git', 'rev-parse', 'HEAD'], template).stdout.strip()
        cases = ('clean', 'dirty', 'status-only', 'rename', 'native-failure', 'wrong-source', 'git-failure')
        for case in cases:
            checkout = parent / case
            cloned = run(['git', 'clone', '--quiet', '--no-hardlinks', '-c', 'core.autocrlf=true', str(template), str(checkout)])
            assert cloned.returncode == 0, cloned.stderr
            runner_temp = parent / (case + '-temp')
            runner_temp.mkdir()
            (runner_temp / 'xlog-source-clean-diagnostic.ps1').write_text(helper, encoding='utf-8')
            env = {**os.environ, 'RUNNER_TEMP': str(runner_temp), 'GITHUB_WORKSPACE': str(checkout),
                   'XLOG_DIAGNOSTIC_SOURCE': head if case != 'wrong-source' else '0' * 40,
                   'XLOG_EXECUTOR_WORKFLOW_SHA': '1' * 40, 'XLOG_EXECUTOR_REF_SHA': '2' * 40}
            if case == 'dirty':
                (checkout / 'tracked.txt').write_bytes(b'GENUINE TRACKED CHANGE\n')
                (checkout / 'untracked name é.txt').write_bytes(b'UNTRACKED_BODY_MUST_NOT_BE_UPLOADED\n')
            if case == 'status-only':
                assert (checkout / 'tracked.txt').read_bytes() == b'original\r\n'
                (checkout / 'tracked.txt').write_bytes(original)
            if case == 'rename':
                moved = run(['git', 'mv', 'tracked.txt', 'renamed name é.txt'], checkout)
                assert moved.returncode == 0, moved.stderr
            if case == 'git-failure':
                broken = parent / 'broken-index'
                broken.write_bytes(b'not an index')
                env['GIT_INDEX_FILE'] = str(broken)
            action = 'Complete-XLogDiagnosticStage "00-fixture"'
            if case == 'native-failure':
                action = 'Invoke-XLogDiagnosticStage "00-fixture" { Invoke-XLogNative pwsh @("-NoProfile","-Command","exit 17") }'
            driver = parent / (case + '.ps1')
            driver.write_text('. (Join-Path $env:RUNNER_TEMP "xlog-source-clean-diagnostic.ps1")\n' + action + '\n', encoding='utf-8')
            before = {p.name: p.read_bytes() for p in checkout.iterdir() if p.is_file()}
            result = run(['pwsh', '-NoProfile', '-File', str(driver)], checkout, env)
            assert (result.returncode == 0) == (case == 'clean'), result.stdout + result.stderr
            assert before == {p.name: p.read_bytes() for p in checkout.iterdir() if p.is_file()}
            evidence = runner_temp / 'xlog-source-clean-receipts/00-fixture'
            receipt = json.loads((evidence / 'receipt.json').read_text(encoding='utf-8'))
            assert receipt['schema'] == 2
            assert receipt['clean'] == (case in ('clean', 'native-failure'))
            assert receipt['stageExitCode'] == (17 if case == 'native-failure' else 0)
            assert (receipt['git']['status']['exitCode'] == 0) == (case != 'git-failure')
            assert receipt['untrackedBodiesCopied'] is False
            assert all(b'UNTRACKED_BODY_MUST_NOT_BE_UPLOADED' not in p.read_bytes() for p in evidence.iterdir())
            files = {entry['path']: entry for entry in receipt['files']}
            for path, entry in files.items():
                assert entry['snapshotPhase'] == 'before-diff'
                if entry['exists']:
                    assert entry['sha256'] == hashlib.sha256((checkout / path).read_bytes()).hexdigest()
            if case == 'status-only':
                assert receipt['statusEntries'] == [' M tracked.txt']
                assert files['tracked.txt']['sha256'] == hashlib.sha256(original).hexdigest()
                assert (evidence / 'tracked-diff.stdout').read_bytes() == b''
                assert (evidence / 'changed-paths.stdout').read_bytes() == b''
            if case == 'dirty':
                assert set(files) == {'tracked.txt', 'untracked name é.txt'}
                assert (evidence / 'tracked-diff.stdout').stat().st_size > 0
            if case == 'rename':
                assert set(files) == {'tracked.txt', 'renamed name é.txt'}
                assert files['tracked.txt']['exists'] is False
                assert files['tracked.txt']['kind'] == 'status-original'
        print(json.dumps({'state': 'passed', 'powerShellScriptsParsed': len(list(scripts.glob('*.ps1'))),
                          'fixtureCases': list(cases), 'rawStatusOnlyHashesRetained': True,
                          'untrackedBodiesExcluded': True, 'sourceBytesUnchanged': True,
                          'workflowSHA256': hashlib.sha256(WORKFLOW.read_bytes()).hexdigest()}))


if __name__ == '__main__':
    main()
