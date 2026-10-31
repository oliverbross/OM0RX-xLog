#!/usr/bin/env python3
"""Fail closed if an application payload contains operator state or a logbook.

Run against the staged application directory, before creating the outer installer.
This checks runtime payloads, not the developer's working tree or Git history.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import re
import zipfile

FORBIDDEN_NAMES = {
    'workspace.json', 'settings.json', 'preferences.json',
    'forwarded-radio-spots.json', '.xlog-offline-acceptance.json',
    'operator-draft.json', 'contact-edit-journal.json',
    'credentials.json', 'secrets.json', 'tokens.json', 'edit-generation.json',
}
FORBIDDEN_DIRECTORIES = {'application support', 'keychains', 'backups', 'recovery', 'recordings'}
FORBIDDEN_SUFFIX = re.compile(r'\.(?:sqlite(?:3)?(?:-(?:wal|shm))?|db(?:-(?:wal|shm))?|adi|adif|xlogbackup|keychain(?:-db)?|p12|pfx)(?:\.gz)?$', re.I)
PRIVATE_KEYS = {
    'stationcall', 'operatorcall', 'qrzusername', 'qrzpassword', 'hamqthusername',
    'hamqthpassword', 'wavelogurl', 'wavelogapikey', 'wavelogtoken',
    'ftpbackuppassword', 'dropboxrefreshtoken', 'googledriverefreshtoken',
    'onedriverefreshtoken', 'apikey', 'password', 'accesstoken', 'refreshtoken',
}
MAX_JSON = 4 * 1024 * 1024


def private_json(value):
    if isinstance(value, dict):
        normalized = {}
        for key, item in value.items():
            normal = re.sub(r'[^a-z0-9]', '', key.lower())
            normalized[normal] = item
            if normal in PRIVATE_KEYS and isinstance(item, str) and item.strip():
                return 'non-empty operator/account setting: ' + key
        if isinstance(normalized.get('call'), str) and normalized['call'].strip() and any(
                key in normalized for key in ['start', 'qsodate', 'qsostart', 'timeon']):
            return 'saved QSO record'
        for item in value.values():
            reason = private_json(item)
            if reason:
                return reason
    elif isinstance(value, list):
        for item in value:
            reason = private_json(item)
            if reason:
                return reason
    return None


def inspect_bytes(name, data):
    if data.startswith(b'SQLite format 3\x00'):
        return 'SQLite database payload'
    declared_json = name.lower().endswith('.json')
    if declared_json and len(data) > MAX_JSON:
        return 'JSON payload exceeds privacy inspection limit'
    if (declared_json or data.lstrip().startswith((b'{', b'['))) and len(data) <= MAX_JSON:
        try:
            return private_json(json.loads(data))
        except (UnicodeDecodeError, json.JSONDecodeError):
            if declared_json:
                return 'unreadable JSON payload'
    return None


def path_reason(name):
    parts = Path(name.replace('\\', '/')).parts
    if '..' in parts or name.startswith(('/', '\\')) or PureWindowsPath(name).drive:
        return 'absolute or traversing archive path'
    if any(part.lower() in FORBIDDEN_DIRECTORIES for part in parts):
        return 'operator state directory'
    if parts and parts[-1].lower() in FORBIDDEN_NAMES:
        return 'operator state filename'
    if FORBIDDEN_SUFFIX.search(name):
        return 'logbook, ADIF, backup or private credential file'
    return None


def scan(root):
    root = root.resolve(strict=True)
    if not root.is_dir():
        raise ValueError('Expected a staged application directory')
    findings, files, links = [], [], []
    for current, directories, names in os.walk(root, followlinks=False):
        for name in sorted(directories + names):
            path = Path(current) / name
            relative = path.relative_to(root).as_posix()
            reason = path_reason(relative)
            if reason:
                findings.append({'path': relative, 'reason': reason})
            if path.is_symlink():
                try:
                    target = path.resolve(strict=True)
                    if not target.is_relative_to(root):
                        findings.append({'path': relative, 'reason': 'symlink escapes application payload'})
                    links.append({'path': relative, 'target': os.readlink(path)})
                except OSError:
                    findings.append({'path': relative, 'reason': 'broken symlink'})
                continue
            if not path.is_file():
                continue
            digest = hashlib.sha256()
            with path.open('rb') as stream:
                sample = stream.read(MAX_JSON + 1)
                digest.update(sample)
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(block)
            reason = inspect_bytes(relative, sample)
            if reason:
                findings.append({'path': relative, 'reason': reason})
            if path.suffix.lower() == '.gz':
                try:
                    with gzip.open(path, 'rb') as stream:
                        reason = inspect_bytes(relative.removesuffix('.gz'), stream.read(MAX_JSON + 1))
                    if reason:
                        findings.append({'path': relative, 'reason': 'compressed ' + reason})
                except (OSError, EOFError):
                    findings.append({'path': relative, 'reason': 'invalid compressed payload'})
            if path.suffix.lower() in {'.zip', '.whl'}:
                try:
                    with zipfile.ZipFile(path) as archive:
                        if len(archive.infolist()) > 100_000:
                            raise ValueError('oversized archive inventory')
                        for entry in archive.infolist():
                            reason = path_reason(entry.filename)
                            if not reason and not entry.is_dir():
                                suffix = Path(entry.filename).suffix.lower()
                                if suffix in {'.zip', '.whl'}:
                                    reason = 'nested archive cannot be privacy-audited'
                                else:
                                    with archive.open(entry) as stream:
                                        if suffix == '.gz':
                                            with gzip.GzipFile(fileobj=stream) as compressed:
                                                reason = inspect_bytes(entry.filename.removesuffix('.gz'), compressed.read(MAX_JSON + 1))
                                        else:
                                            reason = inspect_bytes(entry.filename, stream.read(MAX_JSON + 1))
                            if reason:
                                findings.append({'path': relative + '!' + entry.filename, 'reason': reason})
                except (OSError, EOFError, ValueError, RuntimeError, zipfile.BadZipFile):
                    findings.append({'path': relative, 'reason': 'unreadable archive payload'})
            files.append({'path': relative, 'bytes': path.stat().st_size, 'sha256': digest.hexdigest()})
    return {'schema': 1, 'payload': root.name, 'passed': not findings, 'filesChecked': len(files),
            'findings': findings, 'files': files, 'internalSymlinks': links,
            'scope': 'Staged runtime payload; no personal logbook, operator settings or credentials permitted.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    parser.add_argument('--report', required=True, type=Path)
    arguments = parser.parse_args()
    report = scan(arguments.directory)
    arguments.report.parent.mkdir(parents=True, exist_ok=True)
    arguments.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ['passed', 'filesChecked', 'findings']}))
    raise SystemExit(0 if report['passed'] else 1)
