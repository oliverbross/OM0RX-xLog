#!/usr/bin/env python3
"""Compile the manifest's non-macOS pure IQ slice even on a macOS host."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', type=Path, default=Path.cwd())
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    root = args.repository.resolve()
    output = args.output.absolute()
    if output.exists() or output.is_symlink():
        parser.error('Fixture output must be a new directory')
    manifest = (root / 'Package.swift').read_text()
    branch = manifest.split('\n#else\n', 1)[1].split('\n#endif', 1)[0]
    match = re.search(r'\.target\(name: "XCatIntegrationCore".*?sources: \[(.*?)\]\)', branch, re.S)
    if not match:
        parser.error('Cannot identify the non-macOS integration target')
    sources = re.findall(r'"([^"\n]+\.swift)"', match.group(1))
    tests = ['CWIQParserTests.swift', 'FlexIQIdentityTests.swift', 'FlexIQResourceTests.swift']
    output.mkdir(parents=True)
    hashes = {}
    for folder, names, original in [('Sources/XCatIntegrationCore', sources, 'Sources/XCatIntegrationCore'),
                                    ('Tests/PortableIQTests', tests, 'Tests/XCatIntegrationTests')]:
        target = output / folder
        target.mkdir(parents=True)
        for name in names:
            if Path(name).name != name:
                parser.error('Unexpected source path in fixture manifest')
            data = (root / original / name).read_bytes()
            (target / name).write_bytes(data)
            hashes[str(Path(original) / name)] = hashlib.sha256(data).hexdigest()
    (output / 'Package.swift').write_text('''// swift-tools-version: 5.10
import PackageDescription
let package = Package(name: "PortableIQManifestRegression", platforms: [.macOS(.v14)], targets: [
    .target(name: "XCatIntegrationCore"),
    .testTarget(name: "PortableIQTests", dependencies: ["XCatIntegrationCore"])
])
''')
    command = ['swift', 'test', '--package-path', str(output), '--scratch-path', str(output / 'build'),
               '--jobs', '2', '--no-parallel']
    with (output / 'swift-test.log').open('wb') as stream:
        result = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT)
    receipt = {'declaredSources': sources, 'existingRegressionTests': tests, 'sourceSHA256': hashes,
               'command': command, 'exitCode': result.returncode}
    (output / 'result.json').write_text(json.dumps(receipt, indent=2) + '\n')
    sys.stdout.buffer.write((output / 'swift-test.log').read_bytes())
    print(json.dumps(receipt), flush=True)
    return result.returncode


if __name__ == '__main__':
    raise SystemExit(main())
