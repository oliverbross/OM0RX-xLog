#!/usr/bin/env python3
"""Stage and verify reviewed portable Swift pins without changing Mac dependencies.

SwiftPM 6.3.3 hashes the selected root manifest plus explicit root-dependency
locations (primary source is recorded in portable-swift-pins.json). This adapter
supports this repository's single Package.swift and no extra package roots.
Every guarded command preserves an ignored receipt, including failures.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time
import uuid


def regular_bytes(path):
    attributes = path.lstat()
    if not stat.S_ISREG(attributes.st_mode) or attributes.st_nlink != 1:
        raise RuntimeError(f'Refusing non-regular, linked or aliased authority file: {path}')
    if attributes.st_size > 1_048_576:
        raise RuntimeError(f'Authority file exceeds its size limit: {path}')
    return path.read_bytes()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f'Duplicate JSON key: {key}')
        result[key] = value
    return result


def decode(data):
    return json.loads(data.decode('utf-8'), object_pairs_hook=unique_object)


def expected_lock(root):
    if list(root.glob('Package@swift*.swift')):
        raise RuntimeError('Versioned Swift manifests require an explicitly reviewed origin-hash policy.')
    manifest = regular_bytes(root / 'Package.swift')
    manifest.decode('utf-8')
    pins_bytes = regular_bytes(root / 'prototype/portable-swift-pins.json')
    policy = decode(pins_bytes)
    if type(policy.get('schema')) is not int or policy['schema'] != 1 or policy.get('resolvedFileVersion') != 3:
        raise RuntimeError('Unsupported portable Swift pin policy.')
    pins = policy.get('pins')
    if not isinstance(pins, list) or not pins:
        raise RuntimeError('The complete portable Swift pin set is required.')
    identities = []
    for pin in pins:
        if not isinstance(pin, dict) or set(pin) != {'identity', 'kind', 'location', 'state'}:
            raise RuntimeError('Unexpected portable Swift pin fields.')
        state = pin['state']
        if (not isinstance(pin['identity'], str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]*', pin['identity'])
                or pin['kind'] != 'remoteSourceControl'
                or not isinstance(pin['location'], str)
                or not re.fullmatch(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git', pin['location'])
                or not isinstance(state, dict) or set(state) != {'revision', 'version'}
                or not isinstance(state['revision'], str) or not re.fullmatch(r'[0-9a-f]{40}', state['revision'])
                or not isinstance(state['version'], str) or not re.fullmatch(r'\d+\.\d+\.\d+', state['version'])):
            raise RuntimeError('Portable pins require an exact source URL, version and commit revision.')
        identities.append(pin['identity'])
    if identities != sorted(set(identities)):
        raise RuntimeError('Portable Swift pins must be unique and sorted by identity.')
    origin = hashlib.sha256(manifest).hexdigest()
    return {'version': 3, 'originHash': origin, 'pins': pins}, {
        'manifestSHA256': origin, 'pinPolicySHA256': hashlib.sha256(pins_bytes).hexdigest(), 'pins': pins,
    }


def verify(root):
    expected, evidence = expected_lock(root)
    raw = regular_bytes(root / 'Package.resolved')
    if decode(raw) != expected:
        raise RuntimeError('Package.resolved differs from the reviewed full pin set or actual manifest. It was preserved.')
    return {**evidence, 'lockSHA256': hashlib.sha256(raw).hexdigest()}


def prepare(root):
    expected, _ = expected_lock(root)
    lock = root / 'Package.resolved'
    if os.path.lexists(lock):
        return {**verify(root), 'created': False}
    data = (json.dumps(expected, indent=2) + '\n').encode('utf-8')
    # Exclusive creation also refuses a file or symlink introduced after lexists.
    descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as output:
        output.write(data)
    return {**verify(root), 'created': True}


def validate_command(root, command):
    if (len(command) < 3 or Path(command[0]).name not in {'swift', 'swift.exe'}
            or command[1] not in {'build', 'test', 'package'}
            or '--force-resolved-versions' not in command
            or command[1] == 'package' and command[-1] != 'resolve'):
        raise RuntimeError('Use a Swift build/test/resolve command with --force-resolved-versions.')
    locations = []
    for index, value in enumerate(command):
        if value == '--package-path':
            if index + 1 == len(command):
                raise RuntimeError('Missing Swift package path.')
            locations.append(command[index + 1])
        elif value.startswith('--package-path='):
            locations.append(value.split('=', 1)[1])
    if len(locations) > 1 or any((root / value).resolve() != root for value in locations):
        raise RuntimeError('The Swift command must use exactly this package root.')


def receipt(root, value):
    directory = root
    for component in ['.build', 'portable-swift-lock-receipts']:
        directory = directory / component
        if os.path.lexists(directory):
            if directory.is_symlink() or not directory.is_dir():
                raise RuntimeError('Refusing an aliased portable lock receipt directory.')
        else:
            directory.mkdir()
    destination = directory / (str(time.time_ns()) + '-' + str(uuid.uuid4()) + '.json')
    with destination.open('x', encoding='utf-8') as output:
        json.dump(value, output, indent=2)
        output.write('\n')
    return destination


def perform(root, action, command):
    record = {'schema': 1, 'action': action, 'root': str(root), 'started': time.time(), 'state': 'running'}
    result = 0
    try:
        if action == 'run':
            validate_command(root, command)
            record['command'] = command
            record['prepared'] = prepare(root)
            try:
                child = subprocess.run(command, cwd=root, check=False)
                result = child.returncode
                record['childExitCode'] = result
            finally:
                record['verified'] = verify(root)
        elif action == 'prepare':
            record['prepared'] = prepare(root)
        else:
            record['verified'] = verify(root)
        record['state'] = 'complete' if result == 0 else 'child_failed'
    except Exception as error:
        record.update(state='failed', error=str(error))
        result = 1
    record.update(finished=time.time(), exitCode=result)
    path = receipt(root, record)
    print(json.dumps({'portableSwiftLock': record['state'], 'receipt': str(path),
                      **({'error': record['error']} if 'error' in record else {})}), file=sys.stderr)
    return result


def main(arguments=None):
    arguments = list(sys.argv[1:] if arguments is None else arguments)
    boundary = arguments.index('--') if '--' in arguments else len(arguments)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'verify', 'run'])
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[2])
    options = parser.parse_args(arguments[:boundary])
    command = arguments[boundary + 1:] if boundary < len(arguments) else []
    if (options.action == 'run') != bool(command):
        parser.error('Only run accepts a required command after --.')
    return perform(options.root.resolve(), options.action, command)


if __name__ == '__main__':
    sys.exit(main())
