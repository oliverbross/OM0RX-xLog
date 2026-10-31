#!/usr/bin/env python3
"""Stage the source-only contest host and pinned Windows runtime in a new package."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

from runtime_artifacts import ROOT, digest, download, extract, sources


def stage_host(destination):
    target = destination / 'Not1MM/python'
    if target.exists():
        raise ValueError('Contest host destination already exists')
    for relative in ['contest_host', 'vendor/not1mm']:
        source = ROOT / 'python' / relative
        if not source.is_dir():
            raise ValueError(f'Missing contest source: {relative}')
        # Only versioned runtime source is eligible; developer state, tests and
        # Python bytecode caches never enter a public application package.
        paths = subprocess.check_output(['git', 'ls-files', '-z', '--', f'python/{relative}'], cwd=ROOT).decode().split('\0')
        for name in filter(None, paths):
            original = ROOT / name
            if original.is_symlink() or not original.is_file():
                raise ValueError(f'Contest runtime source must be a regular tracked file: {name}')
            output = target / original.relative_to(ROOT / 'python')
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(original, output)
    launcher = target / 'contest_host/launcher.py'
    if not launcher.is_file():
        raise ValueError('Staged contest launcher is missing')
    return {'files': {str(path.relative_to(destination)): digest(path)
                      for path in sorted(target.rglob('*')) if path.is_file()}}


def stage_windows(destination):
    runtime = destination / 'Python'
    if runtime.exists():
        raise ValueError('Python runtime destination already exists')
    archive = download('windows-python')
    # Extraction uses Python's data filter and an independent empty staging root.
    with tempfile.TemporaryDirectory(prefix='xlog-python-', dir=destination.parent) as folder:
        extracted = extract(archive, Path(folder), 'python')
        shutil.copytree(extracted, runtime, symlinks=False)
    if not (runtime / 'python.exe').is_file() or not (runtime / 'python312.dll').is_file():
        raise ValueError('Pinned archive is missing its Windows runtime entry points')
    for name in ['Lib/test', 'Lib/idlelib', 'Lib/turtledemo', 'Lib/ensurepip', 'Lib/site-packages', 'Scripts']:
        path = runtime / name
        if path.exists():
            shutil.rmtree(path)
    # Keep the upstream LICENSE and every component notice alongside the DLLs.
    notices = list(runtime.rglob('*LICENSE*')) + list(runtime.rglob('*license*'))
    if not any(path.is_file() for path in notices):
        raise ValueError('Pinned Python archive has no license notices')
    # Install-only archives omit the full distribution's build metadata. Carry
    # the matching upstream component-license collection as well as LICENSE.txt.
    notice = download('windows-python-licenses')
    notice_target = destination / 'notices/python-build-standalone-20261026-licenses.rst'
    notice_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(notice, notice_target)
    verification = None
    if os.name == 'nt':
        verification = json.loads(subprocess.check_output([
            str(runtime / 'python.exe'), '-I', '-B', str(Path(__file__).with_name('verify-python-runtime.py')),
            '--expected-version', sources()['windows-python']['version']], text=True))
    return {'source': sources()['windows-python'], 'licenses': sources()['windows-python-licenses'], 'verification': verification,
            'executables': {name: digest(runtime / name) for name in ['python.exe', 'python312.dll']}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platform', choices=['windows', 'linux'], required=True)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    destination = args.destination.resolve(strict=True)
    result = {'schema': 1, 'platform': args.platform, 'host': stage_host(destination)}
    if args.platform == 'windows':
        result['python'] = stage_windows(destination)
    else:
        result['python'] = {'executable': '/usr/bin/python3.12', 'source': 'Ubuntu 24.04 python3.12 package dependency'}
    evidence = destination / 'evidence'
    evidence.mkdir(exist_ok=True)
    (evidence / 'contest-runtime.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'platform': args.platform, 'hostFiles': len(result['host']['files']), 'destination': str(destination)}))


if __name__ == '__main__':
    main()
