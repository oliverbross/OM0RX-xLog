#!/usr/bin/env python3
"""Exercise actual HM generation in disposable autocrlf Git checkouts.

This tests local Git's EOL behavior, not a native Windows package or the missing
raw files from an earlier CI run. No source checkout is rewritten or reset.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[2]
OUTPUTS = tuple('prototype/hm-control/' + name for name in
                ('dashboard.css', 'dashboard.js', 'index.html'))
RULES = tuple(path + ' text eol=lf' for path in OUTPUTS)


def run(arguments, cwd):
    result = subprocess.run(arguments, cwd=cwd, capture_output=True, check=True)
    return result.stdout


def metrics(data):
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'lf': data.count(b'\n'), 'crlf': data.count(b'\r\n'),
            'bareCR': data.count(b'\r') - data.count(b'\r\n')}


def observe(checkout):
    # Take raw byte measurements before Git diff can refresh its index metadata.
    files = {path: metrics((checkout / path).read_bytes()) for path in OUTPUTS}
    status = run(['git', 'status', '--porcelain=v1', '--untracked-files=all', '-z'], checkout)
    diff = subprocess.run(['git', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--'],
                          cwd=checkout, capture_output=True, check=True)
    return {'files': files, 'status': status.decode().split('\0')[:-1],
            'diffBytes': len(diff.stdout), 'diffSHA256': hashlib.sha256(diff.stdout).hexdigest(),
            'diffWarnings': diff.stderr.decode().splitlines()}


def fixture(parent, name, attributes, inputs):
    template = parent / (name + '-template')
    template.mkdir()
    (template / '.gitattributes').write_bytes(attributes)
    for relative, data in inputs.items():
        path = template / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    run(['git', 'init', '--quiet'], template)
    run(['git', 'config', 'core.autocrlf', 'false'], template)
    run(['git', 'add', '--all'], template)
    run(['git', '-c', 'user.name=EOL Regression Fixture', '-c',
         'user.email=eol-fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'], template)
    checkout = parent / name
    run(['git', 'clone', '--quiet', '--no-hardlinks', '-c', 'core.autocrlf=true',
         str(template), str(checkout)], parent)
    assert run(['git', 'config', 'core.autocrlf'], checkout).strip() == b'true'
    return checkout


def check():
    attributes = (ROOT / '.gitattributes').read_bytes()
    for rule in RULES:
        assert rule.encode() in attributes.splitlines(), f'Missing targeted LF rule: {rule}'
    before_policy = b'\n'.join(line for line in attributes.splitlines()
                               if line not in {rule.encode() for rule in RULES}) + b'\n'
    inputs = {}
    generator = 'prototype/scripts/build-hm-control.mjs'
    upstream = 'prototype/vendor/ham-mission-control/index.html'
    inventory = 'prototype/vendor/ham-mission-control/ASSETS.json'
    assets = json.loads((ROOT / inventory).read_bytes())
    for relative in (*OUTPUTS, generator, upstream, inventory,
                     *('prototype/public/hm-control-assets/' + asset['name'] for asset in assets)):
        inputs[relative] = (ROOT / relative).read_bytes()
    assert b'\r' not in inputs[upstream], 'Pinned upstream must remain LF for the adapter.'
    tracked = {path: run(['git', 'show', 'HEAD:' + path], ROOT) for path in OUTPUTS}
    for path in OUTPUTS:
        assert b'\r' not in tracked[path] and b'\n' in tracked[path], 'Canonical Git blob must be LF.'
        assert b'\r' not in inputs[path] and b'\n' in inputs[path], 'Generated source must be LF.'
    report = {'schema': 1, 'platform': sys.platform,
              'gitVersion': run(['git', '--version'], ROOT).decode().strip(),
              'nodeVersion': run(['node', '--version'], ROOT).decode().strip(),
              'sourceCommit': run(['git', 'rev-parse', 'HEAD'], ROOT).decode().strip(),
              'generatorSHA256': hashlib.sha256(inputs[generator]).hexdigest(),
              'trackedCanonicalBlobs': {path: metrics(data) for path, data in tracked.items()},
              'scope': 'Actual generator and pinned local asset validation; disposable local Git autocrlf checkouts only. Not native Windows packaging, original CI raw-byte recovery, or whole-app acceptance.'}
    with tempfile.TemporaryDirectory(prefix='xlog-hm-eol-') as temporary:
        parent = Path(temporary)
        for name, policy in (('before-policy', before_policy), ('targeted-lf', attributes)):
            checkout = fixture(parent, name, policy, inputs)
            before = observe(checkout)
            assert not before['status'] and before['diffBytes'] == 0
            run(['node', generator], checkout)
            after = observe(checkout)
            for path in OUTPUTS:
                assert (checkout / path).read_bytes() == inputs[path], 'Actual generator differs from tracked output.'
                assert after['files'][path]['crlf'] == 0 and after['files'][path]['bareCR'] == 0
            assert after['diffBytes'] == 0, 'EOL conversion must not conceal a content difference.'
            report[name] = {'checkout': before, 'generation': after,
                            'generationMatchesTrackedBlobs': all(inputs[p] == tracked[p] for p in OUTPUTS)}
            if name == 'before-policy':
                for path in OUTPUTS:
                    assert before['files'][path]['crlf'] > 0
                    assert before['files'][path]['sha256'] != after['files'][path]['sha256']
                # Some Git/platform versions refresh normalized stat information
                # during status; preserve the actual result rather than assume M.
                assert set(after['status']).issubset({' M ' + path for path in OUTPUTS})
            else:
                assert before['files'] == after['files']
                assert not after['status'], 'Targeted LF checkout must remain clean after actual generation.'
                changed = checkout / OUTPUTS[1]
                changed.write_bytes(changed.read_bytes() + b'\n/* synthetic genuine content change */\n')
                genuine = observe(checkout)
                assert genuine['status'] == [' M ' + OUTPUTS[1]] and genuine['diffBytes'] > 0
                assert b'synthetic genuine content change' in run(['git', 'diff', 'HEAD', '--'], checkout)
                report['genuineContentChange'] = genuine
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, help='Optional new numeric/hash receipt; never overwrite evidence.')
    args = parser.parse_args()
    os.umask(0o077)
    report = check()
    text = json.dumps(report, indent=2) + '\n'
    if args.out:
        with args.out.open('x', encoding='utf-8') as destination:
            destination.write(text)
    print(text, end='')


if __name__ == '__main__':
    main()
