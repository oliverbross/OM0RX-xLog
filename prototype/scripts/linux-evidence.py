#!/usr/bin/env python3
"""QA-only Linux report diagnostics and private evidence ownership recovery."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat


JOURNEYS = ('ui-1', 'ui-2', 'ui-3', 'ui-wayland')
OUTPUTS = {
    'runtime-manifest.json', 'container-image.json', 'installed-payload-scan.json',
    'payload-hash-check.txt', 'native-loader-audit.txt', 'worker.json',
    'worker-contest-runtime-reply.json', 'installed-packages.tsv', 'os-release.txt',
    'user.txt', 'archive-payload-hash-check.txt', 'archive-loader-audit.txt',
    'archive-worker.json', 'archive-worker-contest-runtime-reply.json',
    'acceptance.json', 'wayland-session.json', 'weston-version.txt',
    'weston-process.log', 'weston.log', 'wayland-compositor.process.json',
}
for journey in JOURNEYS:
    OUTPUTS.update(journey + suffix for suffix in (
        '.json', '.log', '.png', '.session.json', '.process.json',
        '.process.host.json', '.timeout.json', '.validation.json'))
# Atomic receipt writes may leave a private temporary after a write failure.
OUTPUTS.update(name + '.tmp' for name in tuple(OUTPUTS) if name.endswith('.json'))


def write_private(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def validate(report, backend):
    report = Path(report)
    if report.stem not in JOURNEYS:
        raise ValueError('Unexpected Linux acceptance journey')
    raw = report.read_bytes()
    value = json.loads(raw)
    fields = value if isinstance(value, dict) else {}
    checks = fields.get('checks')
    checks = checks if isinstance(checks, dict) else {}
    def category(key, allowed):
        item = fields.get(key)
        return item if type(item) is str and item in allowed else 'missing-or-unrecognized'
    diagnostic = {
        'journey': report.stem, 'backend': backend,
        'schema': 1 if fields.get('schema') == 1 else 'missing-or-unrecognized',
        'status': category('status', ('passed', 'failed', 'running')),
        'scope': category('scope', ('integrated-local-ui',)),
        'platform': category('platform', ('linux',)),
        'embeddedUi': fields.get('embeddedUi') if type(fields.get('embeddedUi')) is bool else None,
        'worker': fields.get('worker') if type(fields.get('worker')) is bool else None,
        'checkCount': len(checks),
        'trueCheckCount': sum(item is True for item in checks.values()),
        'falseCheckCount': sum(item is False for item in checks.values()),
        'otherCheckCount': sum(type(item) is not bool for item in checks.values()),
        'reportSHA256': hashlib.sha256(raw).hexdigest(),
        'errorSHA256': hashlib.sha256(json.dumps(fields['error'], sort_keys=True, ensure_ascii=True).encode()).hexdigest()
            if 'error' in fields else None,
    }
    # Retain and print only finite categories/counts/hashes before any assertion.
    write_private(report.with_suffix('.validation.json'), diagnostic)
    print(json.dumps(diagnostic, sort_keys=True), flush=True)
    label = report.stem + ':'
    assert value['schema'] == 1 and value['status'] == 'passed', label + 'schema-status'
    if backend == 'x11':
        assert value['scope'] == 'integrated-local-ui', label + 'scope'
    assert value['embeddedUi'] is True and value['worker'] is True, label + 'embeddedUi-worker'
    assert value['platform'] == 'linux', label + 'platform'
    if backend == 'wayland':
        assert len(value['checks']) >= 14 and all(check is True for check in value['checks'].values()), label + 'checks'


def recover(directory, uid, gid):
    if uid <= 0 or gid < 0:
        raise ValueError('Runner ownership must be non-root')
    directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    result = {'schema': 1, 'status': 'passed', 'recovered': [], 'errors': []}
    try:
        for name in sorted(OUTPUTS):
            fd = None
            try:
                fd = os.open(name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW, dir_fd=directory_fd)
                before = os.fstat(fd)
                if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
                    raise ValueError('Expected one regular synthetic report')
                if before.st_uid not in (uid, 10001) or before.st_mode & 0o7000:
                    raise ValueError('Unexpected synthetic report ownership or mode')
                # No recursion, symlink following, content write or chmod.
                os.fchown(fd, uid, gid)
                after = os.fstat(fd)
                if (after.st_uid, after.st_gid, stat.S_IMODE(after.st_mode), after.st_size) != (
                        uid, gid, stat.S_IMODE(before.st_mode), before.st_size):
                    raise ValueError('Synthetic report metadata changed unexpectedly')
                result['recovered'].append(name)
            except FileNotFoundError:
                pass  # Later journeys need not have run after an earlier failure.
            except (OSError, ValueError) as error:
                result['errors'].append({'report': name, 'errorType': type(error).__name__})
            finally:
                if fd is not None:
                    os.close(fd)
        result['status'] = 'failed' if result['errors'] else 'passed'
        fd = os.open('ownership-recovery.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=directory_fd)
        with os.fdopen(fd, 'w') as stream:
            os.fchown(stream.fileno(), uid, gid)
            json.dump(result, stream, indent=2)
            stream.write('\n')
    finally:
        os.close(directory_fd)
    print(json.dumps({'ownershipRecovery': result['status'], 'recoveredCount': len(result['recovered']),
                      'errorCount': len(result['errors'])}), flush=True)
    return 1 if result['errors'] else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_subparsers(dest='mode', required=True)
    p = modes.add_parser('validate'); p.add_argument('report', type=Path)
    p.add_argument('backend', choices=('x11', 'wayland'))
    p = modes.add_parser('recover'); p.add_argument('directory', type=Path)
    p.add_argument('uid', type=int); p.add_argument('gid', type=int)
    args = parser.parse_args()
    if args.mode == 'validate':
        validate(args.report, args.backend)
        return 0
    return recover(args.directory, args.uid, args.gid)


if __name__ == '__main__':
    raise SystemExit(main())
