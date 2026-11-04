#!/usr/bin/env python3
"""Fail closed if an application payload contains operator state or a logbook.

Run against the staged application directory, before creating the outer installer.
This checks runtime payloads, not the developer's working tree or Git history.
"""
import argparse
import datetime
import gzip
import hashlib
import json
import math
import os
from pathlib import Path, PureWindowsPath
import re
import zipfile
from urllib.parse import urlsplit

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
# This public resource is 6 MB. Its release-only bound stays below the owning
# CountryReferencePack.decode 32,000,000-byte limit; all other JSON keeps 4 MiB.
MAX_COUNTRY_PACK_JSON = 16 * 1024 * 1024
COUNTRY_PACK_NAME = 'country-reference-pack.json'
COUNTRY_COMPONENTS = {'Country.tab', 'CallResolution.tbl', 'AreaOK1RR.tbl',
                      'CountryDel.tab', 'Exceptions.tab', 'Ambiguous.tbl'}
COUNTRY_COVERAGE = {'current-and-deleted', 'date-valid-exact', 'finite-wildcard-area-patterns',
                    'ignored-modifiers', 'declared-ambiguous-prefixes', 'us-digit-district',
                    'argentine-letter-area'}


def country_pack_name(name):
    return name.replace('\\', '/').rsplit('/', 1)[-1] == COUNTRY_PACK_NAME


def inspection_limit(name):
    return MAX_COUNTRY_PACK_JSON if country_pack_name(name) else MAX_JSON


def public_country_pack(value):
    """Strict public shape, following CTYResolver.swift CountryReferencePack.

    Unknown keys are rejected at every level. This is additional qualification
    for the larger inspection budget, never a substitute for private_json.
    """
    def shape(item, required, optional=()):
        return isinstance(item, dict) and set(required) <= item.keys() <= set(required) | set(optional)

    def string(item, maximum, minimum=0):
        return isinstance(item, str) and minimum <= len(item.encode('utf-8')) <= maximum

    def integer(item, low, high):
        return type(item) is int and low <= item <= high

    def date(item):
        if item is None:
            return None
        if not isinstance(item, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z', item):
            raise ValueError('invalid UTC date')
        return datetime.datetime.strptime(item, '%Y-%m-%dT%H:%M:%SZ')

    def pattern(item):
        if not isinstance(item, str) or not 1 <= len(item) <= 128:
            return False
        if not re.fullmatch(r'(?:[A-Z0-9/#?%]|\[[A-Z0-9][A-Z0-9-]*\])*', item):
            return False
        for body in re.findall(r'\[([^]]+)\]', item):
            if body.endswith('-'):
                return False
        re.compile(item.replace('#', '[0-9]').replace('?', '[A-Z]').replace('%', '[A-Z0-9]'))
        return True

    required = {'schemaVersion', 'provider', 'sourceURL', 'sourceRevision', 'normalizerVersion',
                'attribution', 'conflictPolicy', 'components', 'coverage', 'excluded', 'records',
                'ignoredModifiers', 'ambiguousPrefixes'}
    if not shape(value, required, {'sourceVersion'}):
        return False
    if (type(value['schemaVersion']) is not int or value['schemaVersion'] != 1
            or value['normalizerVersion'] != 'xlog-ok1rr-1' or value['conflictPolicy'] != 'reportAmbiguous'
            or not string(value['provider'], 256, 1) or not string(value['attribution'], 4096)
            or not string(value['sourceURL'], 2048)
            or (value.get('sourceVersion') is not None and not string(value['sourceVersion'], 256))
            or not isinstance(value['sourceRevision'], str)
            or not re.fullmatch(r'[a-f0-9]{40}', value['sourceRevision'])):
        return False
    url = urlsplit(value['sourceURL'])
    if (url.scheme != 'https' or not url.hostname or url.username is not None
            or url.password is not None or '?' in value['sourceURL'] or '#' in value['sourceURL']):
        return False
    components = value['components']
    if (not isinstance(components, dict) or set(components) != COUNTRY_COMPONENTS
            or not all(isinstance(v, str) and re.fullmatch(r'[a-f0-9]{64}', v) for v in components.values())):
        return False
    for key, low, high in [('records', 100, 100_000), ('excluded', 0, 10_000),
                           ('ignoredModifiers', 0, 1024), ('ambiguousPrefixes', 0, 2048), ('coverage', 0, 32)]:
        if not isinstance(value[key], list) or not low <= len(value[key]) <= high:
            return False
    if not all(isinstance(v, str) for v in value['coverage']) or set(value['coverage']) != COUNTRY_COVERAGE:
        return False
    if not all(isinstance(v, str) and re.fullmatch(r'[A-Za-z0-9/]{1,32}', v)
               for v in value['ignoredModifiers'] + value['ambiguousPrefixes']):
        return False
    for item in value['excluded']:
        if (not shape(item, {'component', 'line', 'reason'}, {'pattern'})
                or item['component'] not in COUNTRY_COMPONENTS or not integer(item['line'], 1, 2**63-1)
                or not string(item['reason'], 512)
                or (item.get('pattern') is not None and not string(item['pattern'], 256))):
            return False
    identities, record_components = set(), set()
    for item in value['records']:
        if (not shape(item, {'pattern', 'exact', 'deleted', 'country', 'component', 'line'}, {'start', 'end'})
                or not isinstance(item['component'], str) or item['component'] not in COUNTRY_COMPONENTS
                or not integer(item['line'], 1, 2**63-1) or type(item['exact']) is not bool
                or type(item['deleted']) is not bool or not pattern(item['pattern'])):
            return False
        country = item['country']
        if (not shape(country, {'name', 'adif', 'continent', 'cqZone', 'ituZone'}, {'latitude', 'longitude'})
                or not string(country['name'], 512, 1) or not integer(country['adif'], 0, 1000)
                or not integer(country['cqZone'], 0, 40) or not integer(country['ituZone'], 0, 90)
                or country['continent'] not in ['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA']):
            return False
        for key, maximum in [('latitude', 90), ('longitude', 180)]:
            number = country.get(key)
            if number is not None and (type(number) not in (int, float) or not math.isfinite(number) or not -maximum <= number <= maximum):
                return False
        start, end = date(item.get('start')), date(item.get('end'))
        if start is not None and end is not None and start > end:
            return False
        identity = (item['component'], item['line'], item['pattern'], item['exact'], start, end)
        if identity in identities:
            return False
        identities.add(identity)
        record_components.add(item['component'])
    return record_components == COUNTRY_COMPONENTS - {'Exceptions.tab', 'Ambiguous.tbl'}


def unique_json_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate JSON key')
        value[key] = item
    return value


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
    public_pack = country_pack_name(name)
    limit = inspection_limit(name)
    if declared_json and len(data) > limit:
        return 'JSON payload exceeds privacy inspection limit'
    if (declared_json or data.lstrip().startswith((b'{', b'['))) and len(data) <= limit:
        try:
            value = json.loads(data, object_pairs_hook=unique_json_object) if public_pack else json.loads(data)
            reason = private_json(value)
            if reason:
                return reason
            if public_pack and not public_country_pack(value):
                return 'invalid public country reference pack'
            return None
        except (UnicodeError, ValueError, TypeError, OverflowError, RecursionError, re.error):
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
                sample = stream.read(inspection_limit(relative) + 1)
                digest.update(sample)
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    digest.update(block)
            reason = inspect_bytes(relative, sample)
            if reason:
                findings.append({'path': relative, 'reason': reason})
            if path.suffix.lower() == '.gz':
                try:
                    with gzip.open(path, 'rb') as stream:
                        inner_name = relative[:-3]
                        reason = inspect_bytes(inner_name, stream.read(inspection_limit(inner_name) + 1))
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
                                                inner_name = entry.filename[:-3]
                                                reason = inspect_bytes(inner_name, compressed.read(inspection_limit(inner_name) + 1))
                                        else:
                                            reason = inspect_bytes(entry.filename, stream.read(inspection_limit(entry.filename) + 1))
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
