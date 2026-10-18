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
  assert.match(script, /security find-identity -v -p codesigning/);
  assert.match(script, /Developer ID Application:/);
  assert.match(script, /com\.oliverbross\.xlog\.integration\.worker/);
  assert.match(script, /codesign --force --identifier "\$identifier"/);
  assert.match(script, /codesign --verify --deep --strict "\$bundle"/);
});
