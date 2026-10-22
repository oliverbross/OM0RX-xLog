import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { swiftWorkerBuildSystemArgs } from './swift-worker-build-system.mjs';

// This standalone node:test gate uses .check.mjs so Vitest does not collect it.

const source = name => readFileSync(new URL(name, import.meta.url), 'utf8');

test('Mac staging selects the same Xcode build system as the resource-bearing worker', () => {
  assert.deepEqual(swiftWorkerBuildSystemArgs('darwin'), ['--build-system', 'xcode']);
  assert.deepEqual(swiftWorkerBuildSystemArgs('linux'), []);
  assert.deepEqual(swiftWorkerBuildSystemArgs('win32'), []);
  assert.match(source('stage-worker.mjs'), /\['build', \.\.\.swiftWorkerBuildSystemArgs\(process\.platform\),/);
});

test('worker build and bin-path discovery both use the Mac-only build-system wrapper', () => {
  const script = source('build-worker.sh');
  assert.match(script, /if \[\[ "\$\(uname -s\)" == Darwin \]\]; then\s+swift build --build-system xcode "\$@"\s+else\s+swift build "\$@"/);
  assert.match(script, /worker_swift_build --package-path[^\n]+--product xlog-prototype-worker/);
  assert.match(script, /binary_dir="\$\(worker_swift_build --package-path[^\n]+--show-bin-path\)"/);
});

test('Mac packaging resolves Xcode products and retains the strict-signing resource layout', () => {
  const script = source('package-macos.sh');
  assert.match(script, /binary_dir="\$\(XLOG_PORTABLE_ONLY=1 swift build --build-system xcode[^\n]+--show-bin-path\)"/);
  const destinations = [...script.matchAll(/ditto [^\n]*"\$bundle([^"\n]*OM0RXXLogPrototype_X(?:Log|Contest)Core\.bundle)"/g)]
    .map(match => match[1]);
  assert.deepEqual(destinations, [
    '/Contents/Resources/OM0RXXLogPrototype_XLogCore.bundle',
    '/Contents/Resources/OM0RXXLogPrototype_XContestCore.bundle',
  ]);
  assert.match(script, /node --test prototype\/scripts\/mac-worker-packaging\.check\.mjs/);
  assert.match(script, /cargo clean --manifest-path "\$root\/prototype\/src-tauri\/Cargo\.toml" -p xlog-prototype/);
  assert.match(script, /bash "\$root\/prototype\/scripts\/stage-contest-python-macos\.sh" "\$bundle"/);
  assert.match(script, /find "\$bundle\/Contents\/Frameworks\/Python\.framework" -type f -print0/);
  assert.match(script, /\*\.a\|\*\.o\) continue ;;/);
  assert.match(script, /security find-identity -v -p codesigning/);
  assert.match(script, /Developer ID Application:/);
  assert.match(script, /com\.oliverbross\.xlog\.integration\.worker/);
  assert.match(script, /codesign --force --identifier "\$identifier"/);
  assert.match(script, /codesign --verify --deep --strict "\$bundle"/);
  assert.match(script, /Python\.framework" "com\.oliverbross\.xlog\.integration\.python"/);
  assert.match(script, /--finalize-provenance/);
});

test('Mac installation verifies the staged and installed resource/signature layout before launch', () => {
  const script = source('install-macos.sh');
  assert.match(script, /OM0RXXLogPrototype_XLogCore\.bundle/);
  assert.match(script, /OM0RXXLogPrototype_XContestCore\.bundle/);
  assert.match(script, /codesign --verify --deep --strict "\$bundle"/);
  assert.match(script, /codesign --verify --strict "\$bundle\/Contents\/MacOS\/xlog-prototype-worker"/);
  assert.match(script, /source_worker_hash=/);
  assert.match(script, /installed_worker_hash=/);
  assert.match(script, /installation stopped before replacement/);
  assert.match(script, /the previous application was restored/);
});

test('isolated contest packaging stages and signs the complete Python lane', () => {
  const script = source('package-contesting-test-macos.sh');
  assert.match(script, /stage-contest-python-macos\.sh" "\$bundle" "package-contesting-test-macos\.sh"/);
  assert.match(script, /cargo clean --manifest-path "\$root\/prototype\/src-tauri\/Cargo\.toml" -p xlog-prototype/);
  const helper = source('relocate-contest-python.py');
  assert.match(helper, /Contents\/Frameworks\/Python\.framework/);
  assert.match(helper, /Contents\/Resources\/Not1MM\/python"/);
  assert.match(helper, /Contents\/Resources\/Not1MM\/python-runtime\.json/);
  assert.match(helper, /"sourceChanges": run\("git", "-C", ROOT, "status", "--porcelain"\)\.splitlines\(\)/);
  assert.match(helper, /"final-component-signatures-before-outer-app-signature"/);
  assert.match(script, /find "\$bundle\/Contents\/Frameworks\/Python\.framework" -type f -print0/);
  assert.match(script, /\*\.a\|\*\.o\) continue ;;/);
  assert.match(script, /security find-identity -v -p codesigning/);
  assert.match(script, /Developer ID Application:/);
  assert.match(script, /if \[ "\$signing_identity" = - \]; then/);
  assert.match(script, /--options runtime --timestamp --sign "\$signing_identity"/);
  for (const identifier of ['python.helper', 'python', 'worker', 'rigctld', 'rotctld']) {
    assert.match(script, new RegExp(`com\\.oliverbross\\.xlog\\.contesting-test\\.${identifier.replace('.', '\\.')}`));
  }
  assert.match(script, /sign_component "\$bundle" "com\.oliverbross\.xlog\.contesting-test"/);
  assert.match(script, /--finalize-provenance[\s\\]+\n[\s\\]+--packaging-script "package-contesting-test-macos\.sh"/);
});

test('contest Python staging is application-relative and relocation-checked', () => {
  const script = source('stage-contest-python-macos.sh');
  assert.match(script, /source_framework=\/opt\/local\/Library\/Frameworks\/Python\.framework/);
  assert.match(script, /source_python="\$source_framework\/Versions\/3\.12\/bin\/python3\.12"/);
  assert.match(script, /"\$source_python" -I -B "\$repo_root\/prototype\/scripts\/relocate-contest-python\.py"/);
  assert.match(script, /--packaging-script "\$packaging_script"/);
  const helper = source('relocate-contest-python.py');
  assert.match(helper, /site-packages/);
  assert.match(helper, /source_dependency/);
  assert.match(helper, /check_minimum\(source, target\)/);
  assert.match(helper, /sqlite3, ssl, lzma, decimal/);
  assert.match(helper, /DYLD_PRINT_LIBRARIES/);
  assert.match(helper, /sourceExecutableSHA256/);
  assert.match(helper, /PACKAGING_SCRIPTS = \{"package-macos\.sh", "package-contesting-test-macos\.sh"\}/);
});
