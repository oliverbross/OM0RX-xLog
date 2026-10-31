#!/usr/bin/env python3
"""Build a pinned, private Apple Silicon Python framework for macOS 14+."""
import argparse
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys

from runtime_artifacts import ROOT, SOURCE_FILE, digest, download, extract, sources


def run(arguments, cwd, environment):
    print('+ ' + ' '.join(map(str, arguments)), flush=True)
    subprocess.run(list(map(str, arguments)), cwd=cwd, env=environment, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jobs', type=int, default=2)
    parser.add_argument('--compile-only', action='store_true', help='Retain compiled inputs before the private DESTDIR install')
    args = parser.parse_args()
    if platform.system() != 'Darwin' or platform.machine() != 'arm64' or not 1 <= args.jobs <= 4 or sys.version_info < (3, 12):
        raise SystemExit('This runtime builder requires Apple Silicon macOS, a Python 3.12+ build host, and 1–4 jobs')
    entries = sources()
    output = ROOT / '.build/runtime-macos-python-3.12.16-openssl-3.6.4-arm64-min14'
    output.mkdir(parents=True, exist_ok=True)
    framework = output / 'frameworks/Python.framework'
    receipt = output / 'runtime-build.json'
    builder_hash = digest(Path(__file__))
    manifest_hash = digest(SOURCE_FILE)
    inputs = output / 'source-receipts'
    inputs.mkdir(exist_ok=True)
    shutil.copy2(Path(__file__), inputs / f'{builder_hash}-builder.py')
    shutil.copy2(SOURCE_FILE, inputs / f'{manifest_hash}-runtime-sources.json')
    verifier = Path(__file__).with_name('verify-python-runtime.py')
    verifier_hash = digest(verifier)
    shutil.copy2(verifier, inputs / f'{verifier_hash}-verify-python-runtime.py')
    if receipt.exists():
        previous = json.loads(receipt.read_text())
        if previous['builderSHA256'] != builder_hash or previous['runtimeSourcesSHA256'] != manifest_hash:
            raise RuntimeError('Retained runtime uses different build inputs; preserve it and choose a fresh build directory')
        for relative, expected in previous['verifiedExecutables'].items():
            if digest(output / relative) != expected:
                raise RuntimeError('Retained runtime executable differs from its receipt')
        print(framework)
        return
    archives = {name: download(name) for name in ['macos-openssl-source', 'macos-python-source', 'macos-xz-source', 'mozilla-ca']}
    work = output / 'sources'
    work.mkdir(exist_ok=True)
    openssl_source = work / 'openssl-3.6.4'
    python_source = work / 'Python-3.12.16'
    xz_source = work / 'xz-5.8.4'
    if not openssl_source.exists():
        extraction = output / 'openssl-extraction'
        extracted = extract(archives['macos-openssl-source'], extraction, 'openssl-3.6.4')
        extracted.rename(openssl_source)
    if not python_source.exists():
        extraction = output / 'python-extraction'
        extracted = extract(archives['macos-python-source'], extraction, 'Python-3.12.16')
        extracted.rename(python_source)
    if not xz_source.exists():
        extracted = extract(archives['macos-xz-source'], output / 'xz-extraction', 'xz-5.8.4')
        extracted.rename(xz_source)
    environment = dict(os.environ)
    environment.update(MACOSX_DEPLOYMENT_TARGET='14.0', CFLAGS='-O3 -mmacosx-version-min=14.0',
                       LDFLAGS='-Wl,-headerpad_max_install_names', PKG_CONFIG='/usr/bin/false')
    openssl = output / 'openssl'
    if not (openssl_source / 'Makefile').exists():
        run(['/usr/bin/perl', 'Configure', 'darwin64-arm64-cc', 'shared', 'no-tests',
             f'--prefix={openssl}', f'--openssldir={openssl}/ssl'], openssl_source, environment)
    run(['make', f'-j{args.jobs}'], openssl_source, environment)
    run(['make', 'install_sw'], openssl_source, environment)
    certificates = openssl / 'ssl/cert.pem'
    certificates.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(archives['mozilla-ca'], certificates)
    xz = output / 'xz'
    if not (xz_source / 'Makefile').exists():
        run(['./configure', f'--prefix={xz}', '--enable-shared', '--disable-static',
             '--disable-xz', '--disable-xzdec', '--disable-lzmadec', '--disable-lzmainfo',
             '--disable-scripts', '--disable-doc', '--disable-nls'], xz_source, environment)
    run(['make', f'-j{args.jobs}'], xz_source, environment)
    run(['make', 'install'], xz_source, environment)
    environment.update(LIBLZMA_CFLAGS=f'-I{xz}/include',
                       LIBLZMA_LIBS=f'-L{xz}/lib -Wl,-rpath,{xz}/lib -llzma')
    run(['./configure', f'--enable-framework={output}/frameworks', f'--with-openssl={openssl}',
         '--with-openssl-rpath=auto', '--with-ensurepip=no', '--without-readline'], python_source, environment)
    makefile = (python_source / 'Makefile').read_text()
    if '/opt/homebrew/' in makefile or '/opt/local/' in makefile:
        raise RuntimeError('Private runtime configuration selected a developer package-manager dependency')
    run(['make', f'-j{args.jobs}'], python_source, environment)
    if args.compile_only:
        print(f'Compiled runtime retained for private installation: {output}')
        return
    installation = output / 'private-install'
    # Even auxiliary Framework targets are confined to the task's staging root.
    run(['make', 'frameworkinstall', f'DESTDIR={installation}',
         f'PYTHONAPPSDIR={output}/Applications', f'FRAMEWORKUNIXTOOLSPREFIX={output}/unix-tools'], python_source, environment)
    installed = installation / str(framework).lstrip('/')
    if not installed.is_dir() or framework.exists():
        raise RuntimeError('Expected one fresh framework in the private installation root')
    framework.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(installed, framework, symlinks=True)
    runtime = framework / 'Versions/3.12'
    # Developer regression suites and interactive tools are not application runtime inputs.
    for name in ['test', 'idlelib', 'turtledemo', 'ensurepip']:
        folder = runtime / 'lib/python3.12' / name
        if folder.exists():
            shutil.rmtree(folder)
    executable = runtime / 'bin/python3.12'
    bundled_certificates = runtime / 'etc/openssl/cert.pem'
    bundled_certificates.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(archives['mozilla-ca'], bundled_certificates)
    check = subprocess.check_output([str(executable), '-I', '-B',
        str(Path(__file__).with_name('verify-python-runtime.py')), '--expected-version', '3.12.16',
        '--openssl-version', '3.6.4'], text=True, env={
            'LANG': 'C.UTF-8', 'SSL_CERT_FILE': str(bundled_certificates)})
    result = json.loads(check)
    if 'OpenSSL 3.6.4' not in result['openssl']:
        raise RuntimeError('Built Python did not link the pinned OpenSSL runtime')
    native_files = [executable, runtime / 'Python', openssl / 'lib/libssl.3.dylib',
                    openssl / 'lib/libcrypto.3.dylib', xz / 'lib/liblzma.5.dylib']
    for file in native_files:
        subprocess.run(['lipo', '-verify_arch', 'arm64', str(file)], check=True)
        build = subprocess.check_output(['/usr/bin/xcrun', 'vtool', '-show-build', str(file)], text=True)
        minimum = re.findall(r'\bminos\s+([\d.]+)', build)
        if not minimum or any((tuple(map(int, value.split('.'))) + (0, 0))[:3] > (14, 0, 0) for value in minimum):
            raise RuntimeError(f'Built runtime exceeds the macOS 14 deployment target: {file.name}')
    notices = runtime / 'Resources/RuntimeNotices'
    notices.mkdir(parents=True, exist_ok=True)
    shutil.copy2(python_source / 'LICENSE', notices / 'Python-LICENSE.txt')
    shutil.copy2(openssl_source / 'LICENSE.txt', notices / 'OpenSSL-LICENSE.txt')
    shutil.copy2(xz_source / 'COPYING', notices / 'XZ-COPYING.txt')
    shutil.copy2(xz_source / 'COPYING.0BSD', notices / 'XZ-0BSD.txt')
    payload = {'schema': 1, 'builderSHA256': builder_hash, 'runtimeSourcesSHA256': manifest_hash,
                'verificationScriptSHA256': verifier_hash,
               'minimumMacOS': '14.0', 'architecture': 'arm64', 'configureEnvironment': {
                    key: environment[key] for key in ['MACOSX_DEPLOYMENT_TARGET', 'CFLAGS', 'LDFLAGS', 'PKG_CONFIG', 'LIBLZMA_CFLAGS', 'LIBLZMA_LIBS']},
               'sdkVersion': subprocess.check_output(['/usr/bin/xcrun', '--show-sdk-version'], text=True).strip(),
               'compiler': subprocess.check_output(['/usr/bin/cc', '--version'], text=True).strip(),
               'sources': {name: entries[name] for name in archives}, 'verification': result,
                'bundledCertificateSHA256': digest(bundled_certificates),
                'verifiedExecutables': {str(file.relative_to(output)): digest(file) for file in native_files}}
    receipt.write_text(json.dumps(payload, indent=2) + '\n')
    print(framework)


if __name__ == '__main__':
    main()
