#!/usr/bin/env python3
"""Native Ubuntu packaging/audit. Parses standard ldd output, never ELF bytes."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request


def run(*args, env=None):
    return subprocess.check_output(args, text=True, env=env, stderr=subprocess.STDOUT)


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2) + '\n')


def loader(path, env):
    output = run('ldd', str(path), env=env)
    if 'not found' in output:
        raise RuntimeError(f'Unresolved dependency for {path}:\n{output}')
    paths = []
    for line in output.splitlines():
        match = re.search(r'(?:=>\s+)?(/\S+)\s+\(0x[0-9a-f]+\)', line)
        if match:
            paths.append(Path(match[1]))
    return output, paths


def audit(package, output):
    env = dict(os.environ, PATH='/usr/bin:/bin', LD_LIBRARY_PATH=str(package / 'lib'))
    # Native loader metadata and full recursive loader resolutions retained verbatim.
    entries = []
    graph = {}
    library_inventory = {}
    binaries = [package / 'bin/xlog-prototype', package / 'bin/xlog-prototype-worker']
    binaries += sorted((package / 'lib').glob('*.so*'))
    for binary in binaries:
        resolved, paths = loader(binary, env)
        entries.append(f'\n### {binary.relative_to(package)}\n' +
                       run('readelf', '-d', str(binary)) + resolved)
        graph[str(binary.relative_to(package))] = [str(path) for path in paths]
        for dependency in paths:
            canonical = dependency.resolve()
            bundled = canonical.is_relative_to(package.resolve())
            if not bundled and not str(canonical).startswith(('/usr/lib/', '/lib/')):
                raise RuntimeError(f'Unapproved loader origin: {canonical}')
            if str(canonical) not in library_inventory:
                record = {'sha256': digest(canonical), 'origin': 'bundled' if bundled else 'os-package'}
                if not bundled:
                    candidates = [str(dependency), str(canonical)]
                    if str(canonical).startswith('/usr/lib/'):
                        candidates.append(str(canonical).removeprefix('/usr'))
                    for candidate in candidates:
                        try:
                            owner = run('dpkg-query', '-S', candidate).splitlines()[0].split(': /')[0]
                            record['package'] = run('dpkg-query', '-W', '-f=${binary:Package}\t${Version}\t${Architecture}', owner)
                            record['notice'] = f'/usr/share/doc/{owner.split(":")[0]}/copyright'
                            break
                        except subprocess.CalledProcessError:
                            pass
                    if 'package' not in record:
                        raise RuntimeError(f'System dependency has no package provenance: {canonical}')
                library_inventory[str(canonical)] = record
    output.write_text(''.join(entries))
    write_json(output.with_suffix('.json'), {'schema': 1, 'resolutionsByPayload': graph,
                                           'libraries': library_inventory})


def package(root, out, swift_root, sha):
    stage = out / 'om0rx-xlog-prototype-linux-amd64'
    for folder in ['bin', 'lib', 'notices']:
        (stage / folder).mkdir(parents=True)
    for name in ['xlog-prototype', 'xlog-prototype-worker']:
        shutil.copy2(root / 'prototype/src-tauri/target/release' / name, stage / 'bin' / name)
    # The exact native closure decides what is bundled. No host /usr/lib copied.
    env = dict(os.environ)
    runtime = swift_root / 'usr/lib/swift/linux'
    if not runtime.is_dir():
        raise RuntimeError(f'Swift runtime directory is absent: {runtime}')
    env['LD_LIBRARY_PATH'] = str(runtime)
    origins = {}
    queue = list((stage / 'bin').iterdir())
    seen = set()
    while queue:
        binary = queue.pop()
        if binary.resolve() in seen:
            continue
        seen.add(binary.resolve())
        _, dependencies = loader(binary, env)
        for dependency in dependencies:
            canonical = dependency.resolve()
            if canonical.is_relative_to(swift_root):
                target = stage / 'lib' / dependency.name
                if target.exists() and digest(target) != digest(canonical):
                    raise RuntimeError(f'Conflicting bundled SONAME: {dependency.name}')
                if not target.exists():
                    shutil.copy2(canonical, target)
                    origins[str(target.relative_to(stage))] = str(canonical)
                    queue.append(canonical)
            elif not str(canonical).startswith(('/lib/', '/usr/lib/')):
                raise RuntimeError(f'Unapproved build dependency origin: {canonical}')
    if not origins:
        raise RuntimeError('Dynamic Swift closure was unexpectedly empty')
    # Retain licenses/notices supplied by the exact downloaded toolchain.
    notice_count = 0
    for source in sorted(swift_root.rglob('*')):
        if source.is_file() and re.match(r'^(LICENSE|NOTICE|NOTICES|COPYING)([.-].*)?$', source.name, re.I):
            relative = source.relative_to(swift_root)
            target = stage / 'notices/swift-toolchain' / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
            notice_count += 1
    swift_version = run('swift', '--version').strip()
    version = re.search(r'Swift version (\d+\.\d+(?:\.\d+)?)', swift_version)
    if not version:
        raise RuntimeError('Cannot identify exact Swift release for redistribution notices')
    tag = f'swift-{version[1]}-RELEASE'
    notice_sources = {}
    notice_availability = {}
    for repository in ['swift', 'swift-foundation', 'swift-foundation-icu', 'swift-corelibs-foundation', 'swift-corelibs-libdispatch']:
        directory = stage / 'notices' / repository
        directory.mkdir()
        found_license = False
        for filename in ['LICENSE.txt', 'LICENSE.md', 'LICENSE', 'NOTICE.txt', 'NOTICE', 'NOTICES.txt']:
            url = f'https://raw.githubusercontent.com/swiftlang/{repository}/{tag}/{filename}'
            try:
                with urllib.request.urlopen(url, timeout=30) as response:
                    content = response.read()
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    notice_availability[url] = 'not present at release tag'
                    continue
                raise
            (directory / filename).write_bytes(content)
            notice_sources[str((directory / filename).relative_to(stage))] = url
            notice_availability[url] = 'included'
            found_license = found_license or filename.startswith('LICENSE')
        if not found_license:
            raise RuntimeError(f'Version-pinned license missing for {repository} {tag}')
    for name in ['LICENSE', 'NOTICE', 'Package.swift']:
        shutil.copy2(root / name, stage / name)
    for source in ['prototype/package-lock.json', 'prototype/src-tauri/Cargo.lock']:
        shutil.copy2(root / source, stage / Path(source).name)
    shared_notices = root / 'prototype/distribution-metadata'
    if not (shared_notices / 'components.json').is_file():
        raise RuntimeError('Generate shared distribution-metadata before Linux packaging')
    shutil.copytree(shared_notices, stage / 'notices/shared')
    shutil.copy2(root / 'prototype/scripts/linux-runtime-dependencies.txt', stage / 'system-dependencies.txt')
    launcher = stage / 'launch'
    launcher.write_text('#!/bin/sh\nset -eu\npackage="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\n'
                        'export LD_LIBRARY_PATH="$package/lib"\nexec "$package/bin/xlog-prototype" "$@"\n')
    launcher.chmod(0o755)
    audit(stage, stage / 'native-loader-audit.txt')
    dependencies = [line.strip() for line in (stage / 'system-dependencies.txt').read_text().splitlines()
                    if line.strip() and not line.startswith('#')]
    metadata = {'schema': 1, 'commit': sha, 'platform': 'ubuntu-24.04-amd64',
                'swift': swift_version, 'bundledLibraryOrigins': origins,
                'redistributionNoticeSources': notice_sources, 'toolchainNoticeCount': notice_count,
                'redistributionNoticeAvailability': notice_availability,
                'systemPackages': dependencies, 'systemPackageVersions': run('dpkg-query', '-W'),
                'source': f'https://github.com/oliverbross/OM0RX-xLog/tree/{sha}',
                'scope': 'synthetic prototype; no Hamlib, station access or production release'}
    write_json(stage / 'runtime-manifest.json', metadata)
    hashes = {str(path.relative_to(stage)): digest(path) for path in sorted(stage.rglob('*')) if path.is_file()}
    (stage / 'payload.sha256').write_text(''.join(f'{value}  {name}\n' for name, value in hashes.items()))
    deb = out / 'deb-root'
    install = deb / 'opt/om0rx-xlog-prototype'
    shutil.copytree(stage, install)
    (deb / 'DEBIAN').mkdir()
    (deb / 'DEBIAN/control').write_text(
        f'Package: om0rx-xlog-prototype\nVersion: 0.1.0+p1.{sha[:12]}\nArchitecture: amd64\n'
        'Maintainer: OM0RX-xLog Prototype <prototype@om0rx.com>\nSection: utils\nPriority: optional\n'
        f'Depends: {", ".join(dependencies)}\nDescription: Isolated synthetic OM0RX-xLog prototype\n'
        ' No station, account or live logbook access. Ubuntu 24.04 amd64 only.\n')
    (deb / 'usr/bin').mkdir(parents=True)
    command = deb / 'usr/bin/om0rx-xlog-prototype'
    command.write_text('#!/bin/sh\nexec /opt/om0rx-xlog-prototype/launch "$@"\n')
    command.chmod(0o755)
    desktop = deb / 'usr/share/applications/om0rx-xlog-prototype.desktop'
    desktop.parent.mkdir(parents=True)
    desktop.write_text('[Desktop Entry]\nType=Application\nName=OM0RX-xLog Prototype (synthetic)\n'
                       'Exec=/opt/om0rx-xlog-prototype/launch\nTerminal=false\nCategories=Utility;\n')


if __name__ == '__main__':
    if sys.argv[1] == 'package':
        package(*(Path(value).resolve() for value in sys.argv[2:5]), sys.argv[5])
    elif sys.argv[1] == 'audit':
        audit(Path(sys.argv[2]).resolve(), Path(sys.argv[3]))
    else:
        raise SystemExit('Expected package or audit')
